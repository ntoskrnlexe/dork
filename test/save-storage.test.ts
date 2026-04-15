import { test, expect } from 'bun:test';
import { MemorySaveStorage, exportSave, importSave } from '../src/save-storage.ts';

test('MemorySaveStorage round-trips bytes by slot name', () => {
	const s = new MemorySaveStorage();
	expect(s.list()).toEqual([]);
	expect(s.read('alpha')).toBeNull();

	const bytes = new Uint8Array([1, 2, 3, 4, 5]);
	expect(s.write('alpha', bytes)).toBe(true);
	expect(s.list()).toEqual(['alpha']);
	expect(s.read('alpha')).toEqual(bytes);

	s.write('beta', new Uint8Array([9, 9]));
	expect(s.list().sort()).toEqual(['alpha', 'beta']);

	expect(s.delete('alpha')).toBe(true);
	expect(s.read('alpha')).toBeNull();
	expect(s.list()).toEqual(['beta']);
	expect(s.delete('missing')).toBe(false);
});

test('overwriting a slot replaces contents', () => {
	const s = new MemorySaveStorage();
	s.write('x', new Uint8Array([1]));
	s.write('x', new Uint8Array([2, 3]));
	expect(s.read('x')).toEqual(new Uint8Array([2, 3]));
	expect(s.list()).toEqual(['x']);
});

test('exportSave / importSave round-trip via Blob', async () => {
	const bytes = new Uint8Array(256);
	for (let i = 0; i < 256; i++) bytes[i] = i;
	const blob = exportSave(bytes);
	expect(blob.type).toBe('application/octet-stream');
	const back = await importSave(blob);
	expect(back).toEqual(bytes);
});
