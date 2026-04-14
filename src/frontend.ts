import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ZMachine } from './zmachine/index.ts';
import { XtermIO } from './io-xterm.ts';

const DEFAULT_STORY = '/zork1.zip';

async function fetchStory(path: string): Promise<Uint8Array> {
	const res = await fetch(path);
	if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
}

async function main(): Promise<void> {
	const term = new Terminal({
		cursorBlink: true,
		fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
		fontSize: 14,
		theme: { background: '#000000', foreground: '#dddddd' },
		convertEol: false
	});
	const fit = new FitAddon();
	term.loadAddon(fit);

	const host = document.getElementById('terminal');
	if (!host) throw new Error('no #terminal element');
	term.open(host);
	fit.fit();
	window.addEventListener('resize', () => fit.fit());

	const statusEl = document.getElementById('status');
	const storyNameEl = document.getElementById('story-name');
	const storyInput = document.getElementById('story-input') as HTMLInputElement | null;
	const restartBtn = document.getElementById('restart');

	let currentIO: XtermIO | null = null;
	let currentStory: Uint8Array | null = null;
	let currentName = '';

	const startGame = async (story: Uint8Array, name: string): Promise<void> => {
		currentIO?.dispose();
		term.reset();
		currentStory = story;
		currentName = name;
		if (storyNameEl) storyNameEl.textContent = name;

		const io = new XtermIO(term, statusEl);
		currentIO = io;
		const zm = new ZMachine(story, io);
		try {
			await zm.run();
			if (currentIO === io) term.writeln('\r\n\x1b[33m[Game ended.]\x1b[0m');
		} catch (err) {
			if (currentIO === io) term.writeln(`\r\n\x1b[31m[Error: ${String(err)}]\x1b[0m`);
		}
	};

	// Pick initial story: ?story=... in the URL, or the default Zork I.
	const urlStory = new URLSearchParams(location.search).get('story');
	const initialPath = urlStory ?? DEFAULT_STORY;
	term.writeln(`Loading ${initialPath}\u2026`);
	try {
		const bytes = await fetchStory(initialPath);
		await startGame(bytes, initialPath);
	} catch (err) {
		term.writeln(`\x1b[31m${String(err)}\x1b[0m`);
		term.writeln('Use the toolbar above to load a local Z-machine v3 story file.');
	}

	// Local file upload.
	storyInput?.addEventListener('change', async () => {
		const file = storyInput.files?.[0];
		if (!file) return;
		const bytes = new Uint8Array(await file.arrayBuffer());
		await startGame(bytes, file.name);
		storyInput.value = '';
	});

	// Restart the current story from the top.
	restartBtn?.addEventListener('click', () => {
		if (!currentStory) return;
		void startGame(currentStory, currentName);
	});
}

main().catch((err) => {
	console.error(err);
	const host = document.getElementById('terminal');
	if (host) host.textContent = String(err);
});
