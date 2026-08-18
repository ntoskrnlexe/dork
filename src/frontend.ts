import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ZMachine } from './zmachine/index.ts';
import { XtermIO, IODisposedError } from './io-xterm.ts';
import { LocalStorageSaveStorage, exportSave, importSave } from './save-storage.ts';
import { createSavePrompt } from './save-prompt.ts';
import { wireToolbar, type FileLike } from './toolbar.ts';

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
	const upperEl = document.getElementById('upper-window');
	const storyNameEl = document.getElementById('story-name');
	const storyInput = document.getElementById('story-input') as HTMLInputElement | null;
	const restartBtn = document.getElementById('restart');
	const downloadSaveBtn = document.getElementById('download-save');
	const uploadSaveInput = document.getElementById('upload-save') as HTMLInputElement | null;

	let currentIO: XtermIO | null = null;
	let currentStory: Uint8Array | null = null;
	let currentName = '';
	let currentStorage: LocalStorageSaveStorage | null = null;

	const startGame = async (story: Uint8Array, name: string): Promise<void> => {
		currentIO?.dispose();
		term.reset();
		currentStory = story;
		currentName = name;
		if (storyNameEl) storyNameEl.textContent = name;

		const io = new XtermIO(term, statusEl, upperEl);
		const storage = new LocalStorageSaveStorage(`dork.save.${name}`);
		currentStorage = storage;
		const { save, restore } = createSavePrompt(storage, {
			print: (t) => io.print(t),
			prompt: (m) => io.prompt(m)
		});
		io.save = save;
		io.restore = restore;
		currentIO = io;
		const zm = new ZMachine(story, io);
		try {
			await zm.run();
			if (currentIO === io) term.writeln('\r\n\x1b[33m[Game ended.]\x1b[0m');
		} catch (err) {
			// A disposed IO means we deliberately tore this game down (restart, new
			// story) — the replacement is already running, so say nothing.
			if (err instanceof IODisposedError) return;
			if (currentIO === io) term.writeln(`\r\n\x1b[31m[Error: ${String(err)}]\x1b[0m`);
		}
	};

	// Wire the toolbar BEFORE booting a game. startGame's promise only settles
	// when the game ends, so anything sequenced after it would never run.
	wireToolbar(
		{
			storyInput,
			restart: restartBtn,
			downloadSave: downloadSaveBtn,
			uploadSave: uploadSaveInput
		},
		{
			loadStory: (bytes, name) => startGame(bytes, name),

			restart: () => {
				if (!currentStory) return;
				return startGame(currentStory, currentName);
			},

			downloadSave: () => {
				if (!currentStorage) return;
				const slots = currentStorage.list();
				if (slots.length === 0) {
					window.alert('No saves to download.');
					return;
				}
				const choice = window.prompt(`Download which save?\n${slots.join(', ')}`, slots[0]);
				if (!choice) return;
				const bytes = currentStorage.read(choice);
				if (!bytes) {
					window.alert(`No save named "${choice}".`);
					return;
				}
				const url = URL.createObjectURL(exportSave(bytes));
				const a = document.createElement('a');
				a.href = url;
				a.download = `${choice}.qzl`;
				a.click();
				// Defer revoke: some browsers (Firefox) abort the download if the blob
				// URL is released synchronously before the download task picks it up.
				setTimeout(() => URL.revokeObjectURL(url), 0);
			},

			uploadSave: async (file: FileLike) => {
				if (!currentStorage) return;
				const bytes = await importSave(file as unknown as File);
				const suggested = file.name.replace(/\.[^.]+$/, '');
				const name = window.prompt('Save as slot:', suggested);
				if (!name) return;
				if (currentStorage.write(name, bytes)) {
					window.alert(`Saved to slot "${name}".`);
				} else {
					window.alert('Failed to save (quota exceeded?).');
				}
			}
		}
	);

	// Pick initial story: ?story=... in the URL, or the default Zork I.
	const urlStory = new URLSearchParams(location.search).get('story');
	const initialPath = urlStory ?? DEFAULT_STORY;
	term.writeln(`Loading ${initialPath}\u2026`);
	try {
		const bytes = await fetchStory(initialPath);
		// Deliberately not awaited — this settles only when the game ends.
		void startGame(bytes, initialPath);
	} catch (err) {
		term.writeln(`\x1b[31m${String(err)}\x1b[0m`);
		term.writeln('Use the toolbar above to load a local Z-machine v3 story file.');
	}
}

main().catch((err) => {
	console.error(err);
	const host = document.getElementById('terminal');
	if (host) host.textContent = String(err);
});
