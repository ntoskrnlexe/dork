import { test, expect } from 'bun:test';
import { normalizeRead, type ReadTimer, type ZMachineIO } from '../src/zmachine/io.ts';

test('normalizeRead folds both read-return shapes into a single ReadResult', () => {
	expect(normalizeRead('hello')).toEqual({ text: 'hello', cancelled: false });
	expect(normalizeRead({ text: '', cancelled: true })).toEqual({ text: '', cancelled: true });
});

test('ZMachineIO.read accepts a timer and may return either string or ReadResult', async () => {
	const io: ZMachineIO = {
		print() {},
		read(_maxlen: number, timer?: ReadTimer) {
			if (timer) return { text: '', cancelled: true };
			return 'hello';
		},
	};

	expect(normalizeRead(await io.read(10)).text).toBe('hello');
	const r = normalizeRead(await io.read(10, { tenths: 20 }));
	expect(r.cancelled).toBe(true);
});
