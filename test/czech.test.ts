import { test, expect } from 'bun:test';
import { ZMachine, type ZMachineIO } from '../src/zmachine/index.ts';

class CapturingIO implements ZMachineIO {
	output = '';
	print(text: string): void {
		this.output += text;
	}
	read(): string {
		throw new Error('CZECH should not call READ (non-interactive)');
	}
}

async function runCzech(storyPath: string): Promise<string> {
	const story = new Uint8Array(await Bun.file(storyPath).arrayBuffer());
	const io = new CapturingIO();
	await new ZMachine(story, io, { seed: 1 }).run();
	return io.output;
}

/**
 * CZECH's "Header (No tests)" section reports our interpreter's self-declared
 * capability flags — those legitimately differ between interpreters and aren't
 * a correctness signal. Drop the block for comparison, and collapse any run
 * of blank lines so formatting differences don't matter.
 */
function normalize(text: string): string {
	return text
		.replace(/\r\n/g, '\n')
		.replace(/Header \(No tests\)[\s\S]*?\n(?=Print opcodes|\s*$)/, '[HEADER-BLOCK]\n')
		.replace(/\n{2,}/g, '\n\n')
		.trim();
}

async function conformanceCheck(version: 3 | 4 | 5): Promise<void> {
	const actual = await runCzech(`test/fixtures/czech.z${version}`);
	const expected = await Bun.file(`test/fixtures/czech.out${version}`).text();
	await Bun.write(`test/czech.actual${version}.txt`, actual);

	// CZECH prints its own Pass/Fail summary; success = "Failed: 0" in the output.
	expect(actual).toContain('Failed: 0');
	expect(actual).toContain("Didn't crash: hooray!");

	// And the rest of the transcript should match the reference (header block aside).
	expect(normalize(actual)).toBe(normalize(expected));
}

test('CZECH conformance at v3', () => conformanceCheck(3), 30_000);
test('CZECH conformance at v4', () => conformanceCheck(4), 30_000);
test('CZECH conformance at v5', () => conformanceCheck(5), 30_000);
