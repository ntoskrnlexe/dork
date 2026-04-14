import type { Terminal, IDisposable } from '@xterm/xterm';
import type { ZMachineIO } from './zmachine/index.ts';

export class XtermIO implements ZMachineIO {
	private readonly term: Terminal;
	private readonly statusEl: HTMLElement | null;
	private inputBuffer = '';
	private resolveRead: ((value: string) => void) | null = null;
	private col = 0;
	private readonly history: string[] = [];
	private historyIdx = 0;
	private readonly dataDisposable: IDisposable;
	private disposed = false;

	constructor(term: Terminal, statusEl: HTMLElement | null = null) {
		this.term = term;
		this.statusEl = statusEl;
		this.dataDisposable = term.onData((d) => this.handleInput(d));
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.dataDisposable.dispose();
		// Unstick any pending read so the old ZMachine loop can fall through.
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
		const width = this.term.cols;
		// Split keeping newlines as their own tokens.
		const pieces = text.split(/(\n)/);
		for (const piece of pieces) {
			if (piece === '\n') {
				this.term.write('\r\n');
				this.col = 0;
				continue;
			}
			if (piece === '') continue;

			// Word-wrap within the piece (alternating whitespace / non-whitespace tokens).
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

	read(): Promise<string> {
		return new Promise((resolve) => {
			this.resolveRead = resolve;
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

	save(buf: Uint8Array): boolean {
		try {
			const b64 = btoa(String.fromCharCode(...buf));
			localStorage.setItem('dork.save', b64);
			return true;
		} catch {
			return false;
		}
	}

	restore(): Uint8Array | null {
		const b64 = localStorage.getItem('dork.save');
		if (!b64) return null;
		try {
			const bin = atob(b64);
			const arr = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
			return arr;
		} catch {
			return null;
		}
	}
}
