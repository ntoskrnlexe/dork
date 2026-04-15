import { test, expect } from 'bun:test';
import { ZMachine } from '../src/zmachine/index.ts';
import { makeStubIO } from './helpers/stub-io.ts';

/**
 * Praxix is a stricter Z-code interpreter unit test by Dannii Willis.
 * It catches edge cases CZECH misses — 17-bit arithmetic intermediates,
 * inc_chk/dec_chk wraparound semantics, get_prop_len(0), etc.
 * The game answers "all" with either "All tests passed." or a failure summary.
 */
test('Praxix conformance at v5', async () => {
	const story = new Uint8Array(await Bun.file('test/fixtures/praxix.z5').arrayBuffer());
	const { io, output } = makeStubIO({
		read: () =>
			output.value.includes('All tests passed.') || output.value.includes('tests failed overall')
				? 'quit'
				: 'all',
	});
	await new ZMachine(story, io, { seed: 1 }).run();

	expect(output.value).toContain('All tests passed.');
	expect(output.value).not.toContain('FAIL');
}, 30_000);
