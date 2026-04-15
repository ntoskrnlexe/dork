import type { SaveStorage } from './save-storage.ts';

/**
 * Minimal terminal-like surface the save prompt uses. Any host that can print
 * lines and read a single line of input qualifies — xterm, readline, modal,
 * or a test double. Keeps the prompt logic free of DOM dependencies.
 */
export interface SavePromptUI {
	print(text: string): void | Promise<void>;
	prompt(message: string): Promise<string>;
}

export interface SavePromptHandlers {
	save: (bytes: Uint8Array) => Promise<boolean>;
	restore: () => Promise<Uint8Array | null>;
}

/**
 * Build `save` / `restore` functions matching the `ZMachineIO` contract by
 * composing named-slot storage with a user prompt surface.
 */
export function createSavePrompt(storage: SaveStorage, ui: SavePromptUI): SavePromptHandlers {
	const save = async (bytes: Uint8Array): Promise<boolean> => {
		const existing = storage.list();
		if (existing.length > 0) {
			await ui.print(`Existing saves: ${existing.join(', ')}\n`);
		}
		const name = (await ui.prompt('Save name (blank to cancel): ')).trim();
		if (!name) return false;
		return storage.write(name, bytes);
	};

	const restore = async (): Promise<Uint8Array | null> => {
		const existing = storage.list();
		if (existing.length === 0) {
			await ui.print('No saved games.\n');
			return null;
		}
		await ui.print(`Saves: ${existing.join(', ')}\n`);
		const name = (await ui.prompt('Restore which (blank to cancel): ')).trim();
		if (!name) return null;
		return storage.read(name);
	};

	return { save, restore };
}
