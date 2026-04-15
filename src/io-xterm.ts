import type { Terminal, IDisposable } from '@xterm/xterm';
import type { ZMachineIO, ReadResult, ReadTimer } from './zmachine/index.ts';

const WINDOW_LOWER = 0;
const WINDOW_UPPER = 1;

export class XtermIO implements ZMachineIO {
	save?: (bytes: Uint8Array) => Promise<boolean>;
	restore?: () => Promise<Uint8Array | null>;

	private readonly term: Terminal;
	private readonly statusEl: HTMLElement | null;
	private readonly upperEl: HTMLElement | null;
	private inputBuffer = '';
	private resolveRead: ((value: string) => void) | null = null;
	private col = 0;
	private buffering = true;
	private window = WINDOW_LOWER;
	private upperLines = 0;
	private upperRows: string[] = [];
	private upperCursor = { y: 1, x: 1 };
	private readonly history: string[] = [];
	private historyIdx = 0;
	private readonly dataDisposable: IDisposable;
	private disposed = false;

	constructor(
		term: Terminal,
		statusEl: HTMLElement | null = null,
		upperEl: HTMLElement | null = null,
	) {
		this.term = term;
		this.statusEl = statusEl;
		this.upperEl = upperEl;
		this.dataDisposable = term.onData((d) => this.handleInput(d));
	}

	/** Print a message and await one line of input — for modal-style prompts. */
	async prompt(message: string): Promise<string> {
		this.print(message);
		return (await this.read(255)).text;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.dataDisposable.dispose();
		const r = this.resolveRead;
		this.resolveRead = null;
		if (r) r('');
	}

	private handleInput(data: string): void {
		if (data === '\x1b[A') return this.navigateHistory(-1);
		if (data === '\x1b[B') return this.navigateHistory(+1);
		if (data === '\x1b[C' || data === '\x1b[D') return;

		for (const ch of data) {
			const code = ch.charCodeAt(0);
			if (ch === '\r' || ch === '\n') {
				this.term.write('\r\n');
				this.col = 0;
				const line = this.inputBuffer;
				this.inputBuffer = '';
				if (line.trim() !== '') {
					this.history.push(line);
					if (this.history.length > 100) this.history.shift();
				}
				this.historyIdx = this.history.length;
				const r = this.resolveRead;
				if (r) {
					this.resolveRead = null;
					r(line);
				}
			} else if (code === 127 || code === 8) {
				if (this.inputBuffer.length > 0) {
					this.inputBuffer = this.inputBuffer.slice(0, -1);
					this.term.write('\b \b');
				}
			} else if (code >= 32) {
				this.inputBuffer += ch;
				this.term.write(ch);
			}
		}
	}

	private navigateHistory(dir: -1 | 1): void {
		if (this.history.length === 0) return;
		const max = this.history.length;
		const next = Math.max(0, Math.min(max, this.historyIdx + dir));
		if (next === this.historyIdx) return;
		this.historyIdx = next;
		const replacement = next >= max ? '' : this.history[next]!;
		for (let i = 0; i < this.inputBuffer.length; i++) this.term.write('\b \b');
		this.inputBuffer = replacement;
		this.term.write(replacement);
	}

	print(text: string): void {
		if (this.window === WINDOW_UPPER) {
			this.writeUpper(text);
			return;
		}
		const width = this.term.cols;
		const pieces = text.split(/(\n)/);
		for (const piece of pieces) {
			if (piece === '\n') {
				this.term.write('\r\n');
				this.col = 0;
				continue;
			}
			if (piece === '') continue;

			if (!this.buffering) {
				this.term.write(piece);
				this.col = (this.col + piece.length) % width;
				continue;
			}

			const tokens = piece.split(/(\s+)/);
			for (const tok of tokens) {
				if (!tok) continue;
				if (/^\s+$/.test(tok)) {
					if (this.col + tok.length >= width) {
						this.term.write('\r\n');
						this.col = 0;
					} else {
						this.term.write(tok);
						this.col += tok.length;
					}
				} else {
					if (this.col + tok.length > width && this.col > 0) {
						this.term.write('\r\n');
						this.col = 0;
					}
					this.term.write(tok);
					this.col += tok.length;
				}
			}
		}
	}

	private writeUpper(text: string): void {
		// Characters are placed one-per-cell at the cursor; newline resets x and steps y.
		for (const ch of text) {
			if (ch === '\n') {
				this.upperCursor.x = 1;
				this.upperCursor.y += 1;
				continue;
			}
			const y = this.upperCursor.y - 1;
			const x = this.upperCursor.x - 1;
			if (y < 0 || y >= this.upperLines) continue;
			let line = this.upperRows[y] ?? '';
			if (line.length < x) line = line.padEnd(x, ' ');
			line = line.slice(0, x) + ch + line.slice(x + 1);
			this.upperRows[y] = line;
			this.upperCursor.x += 1;
		}
		this.renderUpper();
	}

	private renderUpper(): void {
		if (!this.upperEl) return;
		const rows = this.upperRows.slice(0, this.upperLines);
		while (rows.length < this.upperLines) rows.push('');
		const width = Math.max(1, this.term.cols);
		const padded = rows.map((r) => r.padEnd(width, ' ').slice(0, width));
		this.upperEl.textContent = padded.join('\n');
		this.upperEl.style.display = this.upperLines > 0 ? 'block' : 'none';
	}

	read(_maxlen: number, timer?: ReadTimer): Promise<ReadResult> {
		return new Promise<ReadResult>((resolve) => {
			let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
			this.resolveRead = (line: string): void => {
				if (timeoutHandle !== null) clearTimeout(timeoutHandle);
				resolve({ text: line, cancelled: false });
			};
			if (timer && timer.tenths > 0) {
				timeoutHandle = setTimeout(() => {
					this.resolveRead = null;
					resolve({ text: this.inputBuffer, cancelled: true });
				}, timer.tenths * 100);
			}
		});
	}

	// v18 = globals[2] = moves; v17 = globals[1] = score.
	updateStatusLine(text: string, v18: number, v17: number): void {
		if (!this.statusEl) return;
		const cols = Math.max(40, this.term.cols);
		const left = ' ' + text;
		const right = ` Score: ${v17}  Moves: ${v18} `;
		const pad = Math.max(1, cols - left.length - right.length);
		this.statusEl.textContent = left + ' '.repeat(pad) + right;
	}

	// ─── v4+ windowing and styling ─────────────────────────────────────────

	splitWindow(lines: number): void {
		// Grow with blanks, shrink by truncating (hidden rows are discarded).
		if (lines > this.upperRows.length) {
			while (this.upperRows.length < lines) this.upperRows.push('');
		} else if (lines < this.upperRows.length) {
			this.upperRows.length = lines;
		}
		this.upperLines = lines;
		this.renderUpper();
	}

	setWindow(window: number): void {
		this.window = window;
		// Per spec: moving into the upper window puts the cursor at (1, 1) for v4.
		if (window === WINDOW_UPPER) this.upperCursor = { y: 1, x: 1 };
	}

	eraseWindow(window: number): void {
		if (window === -1) {
			// Erase whole screen and un-split.
			this.upperLines = 0;
			this.upperRows = [];
			this.renderUpper();
			this.clearLower();
		} else if (window === -2) {
			this.clearUpper();
			this.clearLower();
		} else if (window === WINDOW_LOWER) {
			this.clearLower();
		} else if (window === WINDOW_UPPER) {
			this.clearUpper();
		}
	}

	private clearUpper(): void {
		this.upperRows = Array.from({ length: this.upperLines }, () => '');
		this.renderUpper();
	}

	private clearLower(): void {
		this.term.reset();
		this.col = 0;
	}

	eraseLine(value: number): void {
		if (value !== 1) return; // Z-machine defines only value=1
		if (this.window === WINDOW_UPPER) {
			const y = this.upperCursor.y - 1;
			const x = this.upperCursor.x - 1;
			if (y < 0 || y >= this.upperLines) return;
			const line = (this.upperRows[y] ?? '').padEnd(x, ' ').slice(0, x);
			this.upperRows[y] = line;
			this.renderUpper();
		} else {
			this.term.write('\x1b[K');
		}
	}

	setCursor(y: number, x: number): void {
		this.upperCursor = { y, x };
	}

	getCursor(): readonly [number, number] {
		return [this.upperCursor.y, this.upperCursor.x];
	}

	setTextStyle(style: number): void {
		if (this.window === WINDOW_UPPER) return; // upper window styles not yet rendered
		// Reset first so each call sets exactly the requested combination.
		const codes: string[] = ['0'];
		if (style & 1) codes.push('7'); // reverse
		if (style & 2) codes.push('1'); // bold
		if (style & 4) codes.push('3'); // italic
		this.term.write(`\x1b[${codes.join(';')}m`);
	}

	bufferMode(buffering: boolean): void {
		this.buffering = buffering;
	}

}
