import { test, expect } from 'bun:test';
import { ZMachine, type ZMachineIO } from '../src/zmachine/index.ts';

/**
 * crashme (by Andrew Plotkin) generates random Z-code at runtime and executes
 * it. The point is to verify the interpreter doesn't take down its host on
 * garbage input — infinite loops, segfaults, runaway memory use, etc. We run
 * it in non-strict mode (invalid opcodes no-op) with a hard instruction cap
 * and expect crashme itself to reach its "Done." marker.
 */
test('crashme.z5 survives random-code execution and reaches Done', async () => {
	const story = new Uint8Array(await Bun.file('test/fixtures/crashme.z5').arrayBuffer());
	let output = '';
	let reads = 0;
	const io: ZMachineIO = {
		print(t) {
			output += t;
		},
		read(): string {
			reads += 1;
			return ''; // Press Enter through the "press q to abort" prompt.
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
	await new ZMachine(story, io, {
		seed: 1,
		strict: false,
		maxInstructions: 5_000_000,
	}).run();

	expect(output).toContain('Done.');
	expect(reads).toBeLessThan(5);
}, 60_000);
