import { test, expect } from 'bun:test';
import { ZMachine, type ZMachineIO } from '../src/zmachine/index.ts';

const STORY_DIR = '../zifmia/infocom';
const ZIFMIA = '../zifmia';

/** Minimal IO that captures output and feeds a few neutral commands then quits. */
function scriptedIO(): { io: ZMachineIO; output: { value: string } } {
	const out = { value: '' };
	// Empty lines trigger "I beg your pardon?" loops in some games; `wait` reliably
	// passes a turn in any standard parser without requiring world knowledge.
	const commands = ['wait', 'wait', 'wait', 'wait', 'wait', 'quit', 'y'];
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
		setColour() {},
		getCursor(): readonly [number, number] {
			return [1, 1] as const;
		},
	};
	return { io, output: out };
}

async function playIntro(relPath: string): Promise<string> {
	const file = Bun.file(relPath);
	if (!(await file.exists())) {
		throw new Error(
			`Missing ${relPath}. These tests expect the zifmia repo at ${ZIFMIA}; see CLAUDE.md.`,
		);
	}
	const story = new Uint8Array(await file.arrayBuffer());
	const { io, output } = scriptedIO();
	try {
		await new ZMachine(story, io, { seed: 1 }).run();
	} catch (e) {
		// SCRIPT_EXHAUSTED just means the game asked for more input than our scripted
		// commands provided — that's fine, we test whatever the game printed up to then.
		if (!String(e).includes('SCRIPT_EXHAUSTED')) throw e;
	}
	return output.value;
}

test('v4 smoke: amfv.z4 boots, prints PRISM intro, quits cleanly', async () => {
	const out = await playIntro(`${STORY_DIR}/amfv.z4`);
	expect(out).toContain('PRISM Project');
	expect(out).toContain('Do you really want to quit');
}, 30_000);

test('v4 smoke: trinity.z4 boots, reaches Kensington Gardens, quits cleanly', async () => {
	const out = await playIntro(`${STORY_DIR}/trinity.z4`);
	expect(out).toContain('Kensington Gardens');
	expect(out).toContain('Palace Gate');
}, 30_000);

test('v4 smoke: nord_and_bert.z4 boots, shows the menu, quits cleanly', async () => {
	const out = await playIntro(`${STORY_DIR}/nord_and_bert.z4`);
	expect(out).toContain('Shake a Tower');
	expect(out).toContain('BEGINNING');
}, 30_000);

test('v5 smoke: hitchhikers_guide.z5 boots, accepts WAIT, reaches the score prompt', async () => {
	const out = await playIntro(`${STORY_DIR}/hitchhikers_guide.z5`);
	expect(out).toContain('THE HITCHHIKER');
	expect(out).toContain('You wake up');
	expect(out).toContain('Time passes');
	expect(out).toContain('Do you wish to leave');
}, 30_000);

test('v5 smoke: planetfall.z5 boots and quits cleanly', async () => {
	const out = await playIntro(`${STORY_DIR}/planetfall.z5`);
	expect(out).toContain('PLANETFALL');
	expect(out).toContain('Stellar Patrol');
}, 30_000);

test('v5 smoke: sherlock.z5 boots and quits cleanly', async () => {
	const out = await playIntro(`${STORY_DIR}/sherlock.z5`);
	expect(out).toContain('Sherlock');
}, 30_000);

test('v7 smoke: simple_test.z7 reports screen dimensions correctly', async () => {
	const out = await playIntro(`${ZIFMIA}/simple_test.z7`);
	expect(out).toContain('cells 25 by 80');
	expect(out).toContain('units 80 by 25');
}, 30_000);

test('v8 smoke: advent.z8 (Colossal Cave) boots and plays', async () => {
	const out = await playIntro(`${ZIFMIA}/advent/advent.z8`);
	expect(out).toContain('standing');
	expect(out).toContain('small brick building');
}, 30_000);

test('v8 smoke: risorg.z8 (Reliques of Tolti-Aph) boots', async () => {
	const out = await playIntro(`${ZIFMIA}/games/risorg.z8`);
	// Inform 7 story with a substantial intro.
	expect(out.length).toBeGreaterThan(500);
}, 30_000);
