import { test, expect } from 'bun:test';
import { ZMachine, type ZMachineIO } from '../src/zmachine/index.ts';

const STORY_DIR = '/home/beans/dork/zifmia/infocom';

/** Minimal IO that captures output and returns blank input, then QUIT on the 6th read. */
function scriptedIO(): { io: ZMachineIO; output: { value: string } } {
	const out = { value: '' };
	const commands = ['', '', '', '', '', 'quit', 'y'];
	let i = 0;
	const io: ZMachineIO = {
		print(t) {
			out.value += t;
		},
		read(): string {
			if (i >= commands.length) throw new Error('SCRIPT_EXHAUSTED');
			return commands[i++]!;
		},
		splitWindow() {},
		setWindow() {},
		setCursor() {},
		setTextStyle() {},
		bufferMode() {},
		eraseWindow() {},
		eraseLine() {},
		getCursor(): readonly [number, number] {
			return [1, 1] as const;
		},
	};
	return { io, output: out };
}

async function playIntro(game: string): Promise<string> {
	const file = Bun.file(`${STORY_DIR}/${game}`);
	if (!(await file.exists())) {
		throw new Error(
			`Missing ${game}. These tests expect the zifmia repo at ${STORY_DIR}; see CLAUDE.md.`,
		);
	}
	const story = new Uint8Array(await file.arrayBuffer());
	const { io, output } = scriptedIO();
	await new ZMachine(story, io, { seed: 1 }).run();
	return output.value;
}

test('v4 smoke: amfv.z4 boots, prints PRISM intro, quits cleanly', async () => {
	const out = await playIntro('amfv.z4');
	expect(out).toContain('PRISM Project');
	expect(out).toContain('Do you really want to quit');
}, 30_000);

test('v4 smoke: trinity.z4 boots, reaches Kensington Gardens, quits cleanly', async () => {
	const out = await playIntro('trinity.z4');
	expect(out).toContain('Kensington Gardens');
	expect(out).toContain('Palace Gate');
}, 30_000);

test('v4 smoke: nord_and_bert.z4 boots, shows the menu, quits cleanly', async () => {
	const out = await playIntro('nord_and_bert.z4');
	expect(out).toContain('Shake a Tower');
	expect(out).toContain('BEGINNING');
}, 30_000);
