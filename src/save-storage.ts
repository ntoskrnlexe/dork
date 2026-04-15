/**
 * Named-slot persistence for Z-machine save data. Headless: no DOM, no IO, no
 * Z-machine coupling. The Z-machine core delivers an opaque byte buffer to
 * `ZMachineIO.save`; this layer just stores and retrieves those bytes by name.
 */
export interface SaveStorage {
	list(): string[];
	read(slot: string): Uint8Array | null;
	write(slot: string, bytes: Uint8Array): boolean;
	delete(slot: string): boolean;
}

/** In-memory storage. Useful for tests and headless embeds. */
export class MemorySaveStorage implements SaveStorage {
	private readonly slots = new Map<string, Uint8Array>();

	list(): string[] {
		return [...this.slots.keys()];
	}

	read(slot: string): Uint8Array | null {
		return this.slots.get(slot) ?? null;
	}

	write(slot: string, bytes: Uint8Array): boolean {
		this.slots.set(slot, new Uint8Array(bytes));
		return true;
	}

	delete(slot: string): boolean {
		return this.slots.delete(slot);
	}
}

/**
 * Browser localStorage-backed storage. Slots live under a `:slot:` sub-namespace
 * so a user-chosen slot name can never collide with the index key.
 */
export class LocalStorageSaveStorage implements SaveStorage {
	private readonly prefix: string;
	private readonly storage: Storage;

	constructor(prefix = 'dork.save', storage: Storage = localStorage) {
		this.prefix = prefix;
		this.storage = storage;
	}

	private indexKey(): string {
		return `${this.prefix}:index`;
	}

	private slotKey(name: string): string {
		return `${this.prefix}:slot:${name}`;
	}

	private readIndex(): string[] {
		const raw = this.storage.getItem(this.indexKey());
		if (!raw) return [];
		try {
			const parsed = JSON.parse(raw) as unknown;
			return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
		} catch {
			return [];
		}
	}

	private writeIndex(names: string[]): void {
		this.storage.setItem(this.indexKey(), JSON.stringify(names));
	}

	list(): string[] {
		return this.readIndex();
	}

	read(slot: string): Uint8Array | null {
		const b64 = this.storage.getItem(this.slotKey(slot));
		if (!b64) return null;
		try {
			const bin = atob(b64);
			const arr = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
			return arr;
		} catch {
			return null;
		}
	}

	write(slot: string, bytes: Uint8Array): boolean {
		try {
			// String.fromCharCode(...bytes) trips engine argument-count caps (~100k).
			let s = '';
			for (let i = 0; i < bytes.length; i += 0x8000) {
				s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
			}
			this.storage.setItem(this.slotKey(slot), btoa(s));
			const idx = this.readIndex();
			if (!idx.includes(slot)) {
				idx.push(slot);
				this.writeIndex(idx);
			}
			return true;
		} catch {
			return false;
		}
	}

	delete(slot: string): boolean {
		const idx = this.readIndex();
		const pos = idx.indexOf(slot);
		if (pos < 0) return false;
		idx.splice(pos, 1);
		this.writeIndex(idx);
		this.storage.removeItem(this.slotKey(slot));
		return true;
	}
}

/** Package a save buffer as a Blob for download. Caller wires the DOM bits. */
export function exportSave(bytes: Uint8Array): Blob {
	// Copy to a fresh ArrayBuffer so the Blob constructor is happy regardless of
	// whether `bytes.buffer` is ArrayBuffer or SharedArrayBuffer.
	const copy = new Uint8Array(bytes.length);
	copy.set(bytes);
	return new Blob([copy.buffer], { type: 'application/octet-stream' });
}

/** Read a Blob/File back into save bytes. */
export async function importSave(blob: Blob): Promise<Uint8Array> {
	return new Uint8Array(await blob.arrayBuffer());
}
