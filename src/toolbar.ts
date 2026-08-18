/**
 * Toolbar wiring, kept free of xterm and the Z-machine so it can be tested with
 * plain stub elements. The handlers do the real work; this only translates DOM
 * events into calls.
 */

/** The subset of an element we touch — anything with `addEventListener` will do. */
export interface EventTargetLike {
	addEventListener(type: string, listener: (event?: unknown) => void): void;
}

/** The subset of `<input type="file">` we touch. */
export interface FileInputLike extends EventTargetLike {
	files: { readonly length: number; item(i: number): FileLike | null } | null;
	value: string;
}

export interface FileLike {
	name: string;
	arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ToolbarElements {
	storyInput?: FileInputLike | null;
	restart?: EventTargetLike | null;
	downloadSave?: EventTargetLike | null;
	uploadSave?: FileInputLike | null;
}

export interface ToolbarHandlers {
	loadStory(bytes: Uint8Array, name: string): void | Promise<void>;
	restart(): void | Promise<void>;
	downloadSave(): void | Promise<void>;
	uploadSave(file: FileLike): void | Promise<void>;
}

function firstFile(input: FileInputLike): FileLike | null {
	const files = input.files;
	if (!files || files.length === 0) return null;
	return files.item(0);
}

/**
 * Attach the toolbar handlers. Must be called before the game is started —
 * starting a game returns a promise that only settles when the game ends, so
 * awaiting it first would leave the toolbar permanently unwired.
 */
export function wireToolbar(els: ToolbarElements, handlers: ToolbarHandlers): void {
	els.storyInput?.addEventListener('change', () => {
		const input = els.storyInput!;
		const file = firstFile(input);
		if (!file) return;
		void file.arrayBuffer().then(async (buf) => {
			input.value = '';
			await handlers.loadStory(new Uint8Array(buf), file.name);
		});
	});

	els.restart?.addEventListener('click', () => {
		void handlers.restart();
	});

	els.downloadSave?.addEventListener('click', () => {
		void handlers.downloadSave();
	});

	els.uploadSave?.addEventListener('change', () => {
		const input = els.uploadSave!;
		const file = firstFile(input);
		if (!file) return;
		input.value = '';
		void handlers.uploadSave(file);
	});
}
