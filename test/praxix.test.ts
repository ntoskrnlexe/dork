import { test, expect } from 'bun:test';
import { ZMachine, type ZMachineIO } from '../src/zmachine/index.ts';

/**
 * Praxix is a stricter Z-code interpreter unit test by Dannii Willis.
 * It catches edge cases CZECH misses — 17-bit arithmetic intermediates,
 * inc_chk/dec_chk wraparound semantics, get_prop_len(0), etc.
 * The game answers "all" with either "All tests passed." or a failure summary.
 */
test('Praxix conformance at v5', async () => {
	const story = new Uint8Array(await Bun.file('test/fixtures/praxix.z5').arrayBuffer());
	let output = '';
	const io: ZMachineIO = {
		print(t) {
			output += t;
		},
		read(): string {
			if (output.includes('All tests passed.') || output.includes('tests failed overall')) {
				return 'quit';
			}
			return 'all';
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
	await new ZMachine(story, io, { seed: 1 }).run();

	expect(output).toContain('All tests passed.');
	expect(output).not.toContain('FAIL');
}, 30_000);
