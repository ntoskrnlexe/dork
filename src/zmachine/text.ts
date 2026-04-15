import type { Memory } from './memory.ts';

const ALPHABET =
	'abcdefghijklmnopqrstuvwxyz' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' + '*\n0123456789.,!?_#\'"/\\-:()';

/**
 * Default ZSCII → Unicode translation table for codes 155..223 per Z-Machine
 * Standards Document §3.8.3. v5+ games can override with a table in the header
 * extension at byte 0x34; we use defaults for now.
 */
const ZSCII_EXTRA =
	'äöüÄÖÜß»«ëïÿËÏáéíóúýÁÉÍÓÚÝàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛåÅøØãñõÃÑÕæÆçÇþðÞÐ£œŒ¡¿';

/** Translate a raw ZSCII code to a single Unicode character. */
export function zsciiToChar(code: number): string {
	if (code === 13) return '\n';
	if (code === 0) return '';
	if (code >= 155 && code <= 223) return ZSCII_EXTRA[code - 155] ?? '';
	return String.fromCharCode(code);
}

const UNICODE_TO_ZSCII = new Map<number, number>();
for (let i = 0; i < ZSCII_EXTRA.length; i++) {
	UNICODE_TO_ZSCII.set(ZSCII_EXTRA.charCodeAt(i), 155 + i);
}

/**
 * Inverse of `zsciiToChar` — used when writing to a memory stream, where the
 * Z-machine expects raw ZSCII bytes rather than Unicode codepoints. Unmapped
 * codepoints pass through (the caller masks to a byte).
 */
export function charToZscii(code: number): number {
	if (code === 10) return 13;
	return UNICODE_TO_ZSCII.get(code) ?? code;
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
 */
export function decodeText(mem: Memory, fwords: number, addr: number): DecodedText {
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
			o += zsciiToChar(y);
			ts = ps;
		} else if (ts === 5) {
			o += decodeText(mem, fwords, mem.getu(fwords + (y + v) * 2) * 2).text;
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
