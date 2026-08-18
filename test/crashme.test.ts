import { test, expect } from 'bun:test';
import { ZMachine } from '../src/zmachine/index.ts';
import { makeStubIO } from './helpers/stub-io.ts';

/**
 * crashme (by Evin Robertson) generates random Z-code at runtime and executes
 * it. The point is to verify the interpreter doesn't take down its host on
 * garbage input — infinite loops, segfaults, runaway memory use, etc. We run
 * it in non-strict mode (invalid opcodes no-op) with a hard instruction cap
 * and expect crashme itself to reach its "Done." marker.
 */
test('crashme.z5 survives random-code execution and reaches Done', async () => {
	const story = new Uint8Array(await Bun.file('test/fixtures/crashme.z5').arrayBuffer());
	let reads = 0;
	const { io, output } = makeStubIO({
		read: () => {
			reads += 1;
			return ''; // Press Enter through the "press q to abort" prompt.
		},
	});
	await new ZMachine(story, io, {
		seed: 1,
		strict: false,
		maxInstructions: 5_000_000,
	}).run();

	expect(output.value).toContain('Done.');
	expect(reads).toBeLessThan(5);
}, 60_000);
