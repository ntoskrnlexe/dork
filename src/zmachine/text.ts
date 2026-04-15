import type { Memory } from './memory.ts';

const ALPHABET =
	'abcdefghijklmnopqrstuvwxyz' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' + '*\n0123456789.,!?_#\'"/\\-:()';

/**
 * Default ZSCII → Unicode translation table for codes 155..223 per Z-Machine
 * Standards Document §3.8.3. v5+ games can override with a table in the header
 * extension (see `readUnicodeTable` below).
 */
export const DEFAULT_ZSCII_EXTRA =
	'äöüÄÖÜß»«ëïÿËÏáéíóúýÁÉÍÓÚÝàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛåÅøØãñõÃÑÕæÆçÇþðÞÐ£œŒ¡¿';

/**
 * Read a game-supplied Unicode translation table (v5+ header extension).
 * Returns the 69-char table if present, or null to use defaults.
 */
export function readUnicodeTable(mem: Memory): string | null {
	const extAddr = mem.getu(0x36);
	if (extAddr === 0) return null;
	const extLen = mem.getu(extAddr);
	if (extLen < 3) return null;
	const tableAddr = mem.getu(extAddr + 6);
	if (tableAddr === 0) return null;
	const count = mem.bytes[tableAddr]!;
	let out = '';
	// Custom tables may define up to 97 entries (ZSCII 155..251).
	for (let i = 0; i < count && i < 97; i++) {
		out += String.fromCharCode(mem.getu(tableAddr + 1 + i * 2));
	}
	// Pad any unfilled codes with defaults.
	if (out.length < DEFAULT_ZSCII_EXTRA.length) {
		out += DEFAULT_ZSCII_EXTRA.slice(out.length);
	}
	return out;
}

/** Translate a raw ZSCII code to a single Unicode character. */
export function zsciiToChar(code: number, zsciiExtra: string = DEFAULT_ZSCII_EXTRA): string {
	if (code === 13) return '\n';
	if (code === 0) return '';
	// Per §3.8.4, codes 155..251 are the extended (accent / custom) range.
	if (code >= 155 && code <= 251) return zsciiExtra[code - 155] ?? '';
	return String.fromCharCode(code);
}

/**
 * Inverse of `zsciiToChar` — used when writing to a memory stream, where the
 * Z-machine expects raw ZSCII bytes rather than Unicode codepoints. Unmapped
 * codepoints pass through (the caller masks to a byte).
 */
export function charToZscii(code: number, zsciiExtra: string = DEFAULT_ZSCII_EXTRA): number {
	if (code === 10) return 13;
	for (let i = 0; i < zsciiExtra.length; i++) {
		if (zsciiExtra.charCodeAt(i) === code) return 155 + i;
	}
	return code;
}

export interface DecodedText {
	/** The decoded text. */
	text: string;
	/** Address of the first byte past the last Z-word. */
	end: number;
}

/**
 * Decode Z-encoded text starting at `addr`.
 * @param fwords address of the abbreviation table (for shift-5 abbreviations).
 * @param zsciiExtra 155..223 Unicode translation; defaults to the Z-spec default.
 */
export function decodeText(
	mem: Memory,
	fwords: number,
	addr: number,
	zsciiExtra: string = DEFAULT_ZSCII_EXTRA,
): DecodedText {
	let o = '';
	let ps = 0; // permanent shift
	let ts = 0; // temporary shift
	let y = 0; // aux state

	const d = (v: number): void => {
		if (ts === 3) {
			y = v << 5;
			ts = 4;
		} else if (ts === 4) {
			y += v;
			o += zsciiToChar(y, zsciiExtra);
			ts = ps;
		} else if (ts === 5) {
			o += decodeText(mem, fwords, mem.getu(fwords + (y + v) * 2) * 2, zsciiExtra).text;
			ts = ps;
		} else if (v === 0) {
			o += ' ';
		} else if (v < 4) {
			ts = 5;
			y = (v - 1) * 32;
		} else if (v < 6) {
			if (!ts) ts = v - 3;
			else if (ts === v - 3) ps = ts;
			else ps = ts = 0;
		} else if (v === 6 && ts === 2) {
			ts = 3;
		} else {
			o += ALPHABET[ts * 26 + v - 6];
			ts = ps;
		}
	};

	for (;;) {
		const w = mem.getu(addr);
		addr += 2;
		d((w >> 10) & 31);
		d((w >> 5) & 31);
		d(w & 31);
		if (w & 32768) break;
	}
	return { text: o, end: addr };
}
