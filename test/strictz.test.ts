import { test, expect } from 'bun:test';
import { ZMachine, type ZMachineIO } from '../src/zmachine/index.ts';

/**
 * strictz checks that interpreter operations on object 0 don't crash and don't
 * corrupt the default-property table (the bytes immediately before the object
 * table). Every well-behaved op either returns 0/false or silently no-ops.
 */
test('strictz conformance: object-0 operations are safe', async () => {
	const story = new Uint8Array(await Bun.file('test/fixtures/strictz.z5').arrayBuffer());
	let output = '';
	const cmds = ['n', '', '', '', 'quit', 'y'];
	let i = 0;
	const io: ZMachineIO = {
		print(t) {
			output += t;
		},
		read(): string {
			if (i >= cmds.length) throw new Error('SCRIPT_EXHAUSTED');
			return cmds[i++]!;
		},
		splitWindow() {},
		setWindow() {},
		setCursor() {},
		setTextStyle() {},
		bufferMode() {},
		setColour() {},
		eraseWindow() {},
		eraseLine() {},
		getCursor(): readonly [number, number] {
			return [1, 1] as const;
		},
	};
	try {
		await new ZMachine(story, io, { seed: 1 }).run();
	} catch (e) {
		if (!String(e).includes('SCRIPT_EXHAUSTED')) throw e;
	}

	expect(output).toContain('Test completed!');
	expect(output).not.toContain('incorrect');
}, 30_000);
