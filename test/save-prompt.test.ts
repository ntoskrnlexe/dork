import { test, expect } from 'bun:test';
import { MemorySaveStorage } from '../src/save-storage.ts';
import { createSavePrompt, type SavePromptUI } from '../src/save-prompt.ts';

function mockUI(answers: string[]): { ui: SavePromptUI; printed: string[]; prompts: string[] } {
	const printed: string[] = [];
	const prompts: string[] = [];
	const queue = [...answers];
	const ui: SavePromptUI = {
		print(text) {
			printed.push(text);
		},
		prompt(msg) {
			prompts.push(msg);
			return Promise.resolve(queue.shift() ?? '');
		},
	};
	return { ui, printed, prompts };
}

test('save prompts for a name and writes to storage', async () => {
	const storage = new MemorySaveStorage();
	const { ui } = mockUI(['game1']);
	const { save } = createSavePrompt(storage, ui);
	const bytes = new Uint8Array([1, 2, 3]);

	expect(await save(bytes)).toBe(true);
	expect(storage.list()).toEqual(['game1']);
	expect(storage.read('game1')).toEqual(bytes);
});

test('save returns false when user cancels with empty name', async () => {
	const storage = new MemorySaveStorage();
	const { ui } = mockUI(['']);
	const { save } = createSavePrompt(storage, ui);

	expect(await save(new Uint8Array([1]))).toBe(false);
	expect(storage.list()).toEqual([]);
});

test('restore lists existing slots and returns bytes for chosen slot', async () => {
	const storage = new MemorySaveStorage();
	storage.write('alpha', new Uint8Array([1, 2]));
	storage.write('beta', new Uint8Array([3, 4]));
	const { ui, printed } = mockUI(['beta']);
	const { restore } = createSavePrompt(storage, ui);

	const out = await restore();
	expect(out).toEqual(new Uint8Array([3, 4]));
	const joined = printed.join('\n');
	expect(joined).toContain('alpha');
	expect(joined).toContain('beta');
});

test('restore returns null for empty input or missing slot', async () => {
	const storage = new MemorySaveStorage();
	storage.write('alpha', new Uint8Array([1]));
	const { ui: ui1 } = mockUI(['']);
	expect(await createSavePrompt(storage, ui1).restore()).toBeNull();

	const { ui: ui2 } = mockUI(['nope']);
	expect(await createSavePrompt(storage, ui2).restore()).toBeNull();
});

test('restore short-circuits with a message when no saves exist', async () => {
	const storage = new MemorySaveStorage();
	const { ui, printed, prompts } = mockUI([]);
	const { restore } = createSavePrompt(storage, ui);

	expect(await restore()).toBeNull();
	expect(prompts).toEqual([]);
	expect(printed.join('\n')).toMatch(/no saved/i);
});
