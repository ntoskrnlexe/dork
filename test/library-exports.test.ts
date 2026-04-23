import { test, expect } from 'bun:test';
import { ZMachine, normalizeRead } from 'dork';
import { MemorySaveStorage, exportSave, importSave } from 'dork/save-storage';
import { createSavePrompt } from 'dork/save-prompt';
import { XtermIO } from 'dork/io-xterm';

test('dork root entry exposes the Z-machine core', () => {
	expect(typeof ZMachine).toBe('function');
	expect(typeof normalizeRead).toBe('function');
});

test('dork/save-storage subpath exposes headless save helpers', () => {
	expect(typeof MemorySaveStorage).toBe('function');
	expect(typeof exportSave).toBe('function');
	expect(typeof importSave).toBe('function');
});

test('dork/save-prompt subpath exposes the prompt composer', () => {
	expect(typeof createSavePrompt).toBe('function');
});

test('dork/io-xterm subpath exposes the xterm IO adapter', () => {
	expect(typeof XtermIO).toBe('function');
});
