import { test, expect } from 'bun:test';
import type { Terminal } from '@xterm/xterm';
import { XtermIO, IODisposedError } from '../src/io-xterm.ts';

/** Minimal stand-in for xterm's Terminal — XtermIO only needs these four members. */
function fakeTerm(): { term: Terminal; writes: string[]; send: (data: string) => void } {
	const writes: string[] = [];
	let handler: ((data: string) => void) | null = null;
	const term = {
		cols: 80,
		write: (s: string): void => {
			writes.push(s);
		},
		reset: (): void => {
			writes.push('<reset>');
		},
		onData: (h: (data: string) => void) => {
			handler = h;
			return {
				dispose: (): void => {
					handler = null;
				},
			};
		},
	};
	return {
		term: term as unknown as Terminal,
		writes,
		send: (data) => handler?.(data),
	};
}

function fakeEl(): HTMLElement {
	return { textContent: '', style: { display: '' } } as unknown as HTMLElement;
}

test('dispose rejects a pending read instead of feeding the game a blank line', async () => {
	const { term } = fakeTerm();
	const io = new XtermIO(term);
	const pending = io.read(255);
	io.dispose();
	expect(pending).rejects.toBeInstanceOf(IODisposedError);
});

test('read after dispose rejects rather than hanging forever', async () => {
	const { term } = fakeTerm();
	const io = new XtermIO(term);
	io.dispose();
	expect(io.read(255)).rejects.toBeInstanceOf(IODisposedError);
});

test('a disposed IO stops writing to the terminal', () => {
	const { term, writes } = fakeTerm();
	const io = new XtermIO(term);
	io.print('before');
	const seen = writes.length;
	io.dispose();
	io.print('after');
	io.eraseWindow(-1);
	io.setTextStyle(2);
	expect(writes.length).toBe(seen);
});

test('a disposed IO stops writing to the shared status line', () => {
	const { term } = fakeTerm();
	const statusEl = fakeEl();
	const io = new XtermIO(term, statusEl);
	io.updateStatusLine('Kitchen', 4, 10);
	expect(statusEl.textContent).toContain('Kitchen');

	io.dispose();
	io.updateStatusLine('West of House', 0, 0);
	expect(statusEl.textContent).toContain('Kitchen');
	expect(statusEl.textContent).not.toContain('West of House');
});

test('a disposed IO stops rendering the upper window', () => {
	const { term } = fakeTerm();
	const upperEl = fakeEl();
	const io = new XtermIO(term, null, upperEl);
	io.dispose();
	io.splitWindow(3);
	expect(upperEl.textContent).toBe('');
});

test('input still drives reads before disposal', async () => {
	const { term, send } = fakeTerm();
	const io = new XtermIO(term);
	const pending = io.read(255);
	send('north');
	send('\r');
	expect((await pending).text).toBe('north');
});
