import { test, expect } from 'bun:test';
import { Memory } from '../src/zmachine/memory.ts';
import { decodeText, readAlphabetTable } from '../src/zmachine/text.ts';

/**
 * Build a tiny Z-encoded string at addr 0 using three Z-chars per word.
 * Top bit of the final word set to mark end-of-string.
 */
function encodeZWord(z1: number, z2: number, z3: number, end = true): [number, number] {
	const w = (end ? 0x8000 : 0) | ((z1 & 31) << 10) | ((z2 & 31) << 5) | (z3 & 31);
	return [w >> 8, w & 0xff];
}

test('decodeText uses custom alphabet when supplied', () => {
	// z-char 0 = space, z-char 6 = alphabet position 0, z-char 7 = position 1.
	const [a, b] = encodeZWord(0, 6, 7);
	const buf = new Uint8Array(64);
	buf[0] = a;
	buf[1] = b;
	const mem = new Memory(buf, false);

	// Custom alphabet: A0[0]='F' (ZSCII 70), A0[1]='O' (79). Rest stays zero.
	const alphabet = new Uint8Array(78);
	alphabet[0] = 70;
	alphabet[1] = 79;

	const { text } = decodeText(mem, 0, 0, undefined, alphabet);
	expect(text).toBe(' FO');
});

test('decodeText falls back to default alphabet when none supplied', () => {
	const [a, b] = encodeZWord(0, 6, 7); // space + A0[0] + A0[1] = " ab"
	const buf = new Uint8Array(64);
	buf[0] = a;
	buf[1] = b;
	const mem = new Memory(buf, false);

	const { text } = decodeText(mem, 0, 0);
	expect(text).toBe(' ab');
});

test('readAlphabetTable returns null when header byte 0x34 is zero', () => {
	const buf = new Uint8Array(256);
	buf[0] = 5; // version 5
	// bytes 0x34..0x35 stay zero
	const mem = new Memory(buf, false);
	expect(readAlphabetTable(mem)).toBeNull();
});

test('readAlphabetTable loads the 78-byte table from the address at 0x34', () => {
	const buf = new Uint8Array(512);
	buf[0] = 5;
	const tableAddr = 0x100;
	// Write byte-address pointer at header 0x34..0x35 (big-endian by default).
	buf[0x34] = tableAddr >> 8;
	buf[0x35] = tableAddr & 0xff;
	for (let i = 0; i < 78; i++) buf[tableAddr + i] = 65 + (i % 26); // A..Z repeating
	const mem = new Memory(buf, false);

	const table = readAlphabetTable(mem);
	expect(table).not.toBeNull();
	expect(table).toHaveLength(78);
	expect(table?.[0]).toBe(65); // 'A'
	expect(table?.[25]).toBe(90); // 'Z'
});
