import type { Memory } from './memory.ts';

const ALPHABET =
	'abcdefghijklmnopqrstuvwxyz' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' + '*\n0123456789.,!?_#\'"/\\-:()';

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
			if (y === 13) o += '\n';
			else if (y) o += String.fromCharCode(y);
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
