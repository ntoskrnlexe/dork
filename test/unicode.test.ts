import { test, expect } from 'bun:test';
import { ZMachine } from '../src/zmachine/index.ts';
import { makeStubIO } from './helpers/stub-io.ts';

/**
 * David Kinder's Unicode test. Exercises:
 * - ZSCII 155..223 default accented characters (spec §3.8.3).
 * - v5+ header-extension Unicode translation table (custom codes 224+).
 * - print_unicode (EXT:11) across many Unicode blocks.
 */
test('unicode.z5: renders Euro / © / ™ from the game-supplied Unicode table', async () => {
	const story = new Uint8Array(await Bun.file('test/fixtures/unicode.z5').arrayBuffer());
	const { io, output } = makeStubIO({
		read: () => {
			throw new Error('SCRIPT_EXHAUSTED');
		},
	});
	try {
		await new ZMachine(story, io, { seed: 1 }).run();
	} catch (e) {
		if (!String(e).includes('SCRIPT_EXHAUSTED')) throw e;
	}

	// Introduction uses the game's custom table (codes 224-226 → © ™ €).
	expect(output.value).toContain('€');
	expect(output.value).toContain('©');
	expect(output.value).toContain('™');
	expect(output.value).toContain('Greek and Coptic');
	expect(output.value).toContain('Arabic');
}, 30_000);
