import { test, expect } from 'bun:test';
import { ZMachine, type ZMachineIO } from '../src/zmachine/index.ts';

/**
 * David Kinder's Unicode test. Exercises:
 * - ZSCII 155..223 default accented characters (spec §3.8.3).
 * - v5+ header-extension Unicode translation table (custom codes 224+).
 * - print_unicode (EXT:11) across many Unicode blocks.
 */
test('unicode.z5: renders Euro / © / ™ from the game-supplied Unicode table', async () => {
	const story = new Uint8Array(await Bun.file('test/fixtures/unicode.z5').arrayBuffer());
	let output = '';
	const io: ZMachineIO = {
		print(t) {
			output += t;
		},
		read(): string {
			throw new Error('SCRIPT_EXHAUSTED');
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

	// Introduction uses the game's custom table (codes 224-226 → © ™ €).
	expect(output).toContain('€');
	expect(output).toContain('©');
	expect(output).toContain('™');
	// print_unicode renders into Greek, Cyrillic, Arabic blocks.
	expect(output).toContain('Greek and Coptic');
	expect(output).toContain('Arabic');
}, 30_000);
