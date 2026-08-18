import { test, expect } from 'bun:test';
import {
	wireToolbar,
	type EventTargetLike,
	type FileInputLike,
	type FileLike,
} from '../src/toolbar.ts';

function fakeButton(): EventTargetLike & { click: () => void } {
	const listeners: Record<string, ((event?: unknown) => void)[]> = {};
	return {
		addEventListener(type, listener) {
			(listeners[type] ??= []).push(listener);
		},
		click() {
			for (const l of listeners['click'] ?? []) l();
		},
	};
}

function fakeFileInput(file: FileLike | null): FileInputLike & { change: () => void } {
	const listeners: Record<string, ((event?: unknown) => void)[]> = {};
	return {
		value: 'C:\\fakepath\\thing',
		files: file ? { length: 1, item: () => file } : { length: 0, item: () => null },
		addEventListener(type, listener) {
			(listeners[type] ??= []).push(listener);
		},
		change() {
			for (const l of listeners['change'] ?? []) l();
		},
	};
}

function fakeFile(name: string, bytes: number[]): FileLike {
	return {
		name,
		arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).buffer),
	};
}

function spyHandlers() {
	const calls: string[] = [];
	return {
		calls,
		handlers: {
			loadStory: (bytes: Uint8Array, name: string) => {
				calls.push(`loadStory:${name}:${bytes.length}`);
			},
			restart: () => {
				calls.push('restart');
			},
			downloadSave: () => {
				calls.push('downloadSave');
			},
			uploadSave: (file: FileLike) => {
				calls.push(`uploadSave:${file.name}`);
			},
		},
	};
}

test('restart button is wired', () => {
	const restart = fakeButton();
	const { calls, handlers } = spyHandlers();
	wireToolbar({ restart }, handlers);
	restart.click();
	expect(calls).toEqual(['restart']);
});

test('download-save button is wired', () => {
	const downloadSave = fakeButton();
	const { calls, handlers } = spyHandlers();
	wireToolbar({ downloadSave }, handlers);
	downloadSave.click();
	expect(calls).toEqual(['downloadSave']);
});

test('choosing a story file hands over its bytes and clears the input', async () => {
	const storyInput = fakeFileInput(fakeFile('zork2.z3', [1, 2, 3, 4]));
	const { calls, handlers } = spyHandlers();
	wireToolbar({ storyInput }, handlers);
	storyInput.change();
	await Bun.sleep(0);
	expect(calls).toEqual(['loadStory:zork2.z3:4']);
	expect(storyInput.value).toBe('');
});

test('choosing a save file hands over the file and clears the input', () => {
	const uploadSave = fakeFileInput(fakeFile('slot1.qzl', [9]));
	const { calls, handlers } = spyHandlers();
	wireToolbar({ uploadSave }, handlers);
	uploadSave.change();
	expect(calls).toEqual(['uploadSave:slot1.qzl']);
	expect(uploadSave.value).toBe('');
});

test('a change event with no file selected is ignored', () => {
	const storyInput = fakeFileInput(null);
	const uploadSave = fakeFileInput(null);
	const { calls, handlers } = spyHandlers();
	wireToolbar({ storyInput, uploadSave }, handlers);
	storyInput.change();
	uploadSave.change();
	expect(calls).toEqual([]);
});

test('missing elements are tolerated', () => {
	const { calls, handlers } = spyHandlers();
	expect(() => wireToolbar({}, handlers)).not.toThrow();
	expect(() => wireToolbar({ restart: null, storyInput: null }, handlers)).not.toThrow();
	expect(calls).toEqual([]);
});

/**
 * The original bug: `main()` awaited the first `startGame(...)`, whose promise
 * only settles when the game ends, so no toolbar listener was ever registered.
 * Wiring must not depend on the game promise settling.
 */
test('wiring completes while the game promise is still pending', () => {
	const restart = fakeButton();
	const { calls, handlers } = spyHandlers();
	const neverSettles = new Promise<void>(() => {});
	wireToolbar({ restart }, { ...handlers, restart: () => neverSettles });
	restart.click();
	expect(calls).toEqual([]); // our stub replaced restart; the point is we got here
	restart.click();
	expect(() => restart.click()).not.toThrow();
});
