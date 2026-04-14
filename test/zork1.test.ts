import { test, expect } from 'bun:test';
import { ZMachine, type ZMachineIO } from '../src/zmachine/index.ts';

const STORY_PATH = '../zork1/zork1.zip';
const SCRIPT_PATH = 'zork1.script.txt';
const EXPECTED_PATH = 'zork1.script.expected.txt';

interface ParsedScript {
	commands: string[];
	seed?: number;
}

function parseScript(source: string): ParsedScript {
	const commands: string[] = [];
	let seed: number | undefined;
	for (const raw of source.split('\n')) {
		const line = raw.trimEnd();
		if (line === '') continue;
		if (line.startsWith('#')) {
			const m = line.match(/^#random\s+(-?\d+)/);
			if (m) seed = Number(m[1]);
			continue;
		}
		commands.push(line);
	}
	return { commands, seed };
}

class ScriptedIO implements ZMachineIO {
	/** Raw interpreter output, no command echo — for byte-comparison with reference interpreters. */
	output = '';
	/** Human-readable transcript with commands and status lines inlined. */
	transcript = '';
	private cmdIndex = 0;
	private readonly commands: string[];

	constructor(commands: string[]) {
		this.commands = commands;
	}

	print(text: string): void {
		this.output += text;
		this.transcript += text;
	}

	read(): string {
		let cmd: string;
		if (this.cmdIndex >= this.commands.length) {
			const pad = ['quit', 'y'];
			const i = this.cmdIndex - this.commands.length;
			cmd = pad[Math.min(i, pad.length - 1)]!;
		} else {
			cmd = this.commands[this.cmdIndex]!;
		}
		this.cmdIndex++;
		this.transcript += cmd + '\n';
		return cmd;
	}

	// jszm passes (text, v18, v17) where v18=globals[2]=moves, v17=globals[1]=score.
	updateStatusLine(text: string, moves: number, score: number): void {
		const left = ` ${text}`.padEnd(49, ' ');
		const middle = `Score: ${score}`.padEnd(16, ' ');
		const right = `Moves: ${moves}`;
		this.transcript += `${left}${middle}${right}\n`;
	}
}

test('zork1 transcript runs without crashing', async () => {
	const story = new Uint8Array(await Bun.file(STORY_PATH).arrayBuffer());
	const script = parseScript(await Bun.file(SCRIPT_PATH).text());

	const io = new ScriptedIO(script.commands);
	const zm = new ZMachine(story, io, {
		seed: script.seed !== undefined ? script.seed >>> 0 : 42
	});

	await zm.run();

	expect(io.output.length).toBeGreaterThan(1000);
	expect(io.output).toContain('ZORK I');
	expect(io.output).toContain('West of House');
}, 30_000);

/** Reduce a transcript to just its narrative content for cross-interpreter comparison. */
function normalize(text: string): string[] {
	return (
		text
			.split('\n')
			// A leading ">" is just the Zork prompt; the rest of the line may be real narrative
			// (our port runs the prompt and the next print() into the same line).
			.map((line) => line.trim().replace(/^>+\s*/, ''))
			.filter((line) => {
				if (line === '') return false;
				if (/Score:\s+-?\d+\s+Moves:\s+\d+/.test(line)) return false;
				return true;
			})
			.map((line) => line.replace(/\s+/g, ' '))
	);
}

test('zork1 transcript narrative matches dfrotz up to first PRNG-dependent command', async () => {
	const story = new Uint8Array(await Bun.file(STORY_PATH).arrayBuffer());
	const script = parseScript(await Bun.file(SCRIPT_PATH).text());
	const expected = await Bun.file(EXPECTED_PATH).text();

	const io = new ScriptedIO(script.commands);
	const zm = new ZMachine(story, io, { seed: 42 });
	await zm.run();

	await Bun.write('test/actual.txt', io.transcript);

	// Strip dfrotz preamble lines.
	const expectedStripped = expected
		.split('\n')
		.filter((l) => !/^(Using normal formatting|Loading )/.test(l))
		.join('\n');

	const actualFlat = normalize(io.output).flatMap((l) => l.split(' '));
	const expectedFlat = normalize(expectedStripped).flatMap((l) => l.split(' '));

	// Find the first word where the two interpreters diverge.
	let match = 0;
	const limit = Math.min(actualFlat.length, expectedFlat.length);
	while (match < limit && actualFlat[match] === expectedFlat[match]) match++;

	// The first PRNG-driven event in Zork 1 is the "You hear... chirping of a song bird"
	// message, which fires on a random turn. That bounds how far the word-for-word match
	// can extend. In practice we expect at least the full opening scene to agree.
	expect(match).toBeGreaterThanOrEqual(250);
}, 30_000);
