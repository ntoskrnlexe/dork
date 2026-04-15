import { Memory } from './memory.ts';
import { decodeText } from './text.ts';
import { Vocabulary } from './vocab.ts';
import { serialize, deserialize, verify, type CallFrame } from './saves.ts';
import type { ZMachineIO } from './io.ts';

export interface ZMachineOptions {
	isTandy?: boolean;
	seed?: number;
}

/**
 * Z-machine v3 interpreter. Story file goes in; calls into `io` come out.
 * Port of public-domain JSZM (by zzo38) to async/await + TypeScript.
 */
export type ZVersion = 3 | 4;

export class ZMachine {
	readonly memInit: Uint8Array;
	readonly version: ZVersion;
	readonly byteSwapped: boolean;
	readonly statusType: boolean;
	readonly serial: string;
	readonly zorkid: number;
	readonly isTandy: boolean;
	readonly io: ZMachineIO;

	private initialSeed?: number;
	private mem!: Memory;
	private savedFlags = 0;
	private seed = 0;
	private fwords = 0;
	private vocabulary: Vocabulary | null = null;

	constructor(story: ArrayLike<number>, io: ZMachineIO, opts: ZMachineOptions = {}) {
		const bytes = new Uint8Array(story);
		this.memInit = bytes;
		const v = bytes[0];
		if (v !== 3 && v !== 4) throw new Error(`Unsupported Z-code version ${String(v)}.`);
		this.version = v as ZVersion;
		this.byteSwapped = !!(bytes[1]! & 1);
		this.statusType = !!(bytes[1]! & 2);
		this.serial = String.fromCharCode(...bytes.slice(18, 24));
		this.zorkid =
			(bytes[2]! << (this.byteSwapped ? 0 : 8)) | (bytes[3]! << (this.byteSwapped ? 8 : 0));
		this.isTandy = !!opts.isTandy;
		this.initialSeed = opts.seed;
		this.io = io;
	}

	/** Checksum the loaded story against the header-declared value. */
	verify(): boolean {
		return verify(this.memInit, this.mem);
	}

	/**
	 * Decode text starting at `addr`. Convenience wrapper used by tooling;
	 * the opcode loop uses `decodeText` directly for the `end` return value.
	 */
	getText(addr: number): string {
		return decodeText(this.mem, this.fwords, addr).text;
	}

	async run(): Promise<void> {
		let mem!: Memory;
		let bytes!: Uint8Array;
		let pc = 0;
		let cs: CallFrame[] = [];
		let ds: number[] = [];
		let op0 = 0,
			op1 = 0,
			op2 = 0,
			op3 = 0,
			op4 = 0,
			op5 = 0,
			op6 = 0,
			op7 = 0;
		let opc = 0;
		let op3Size = 0; // byte size of the property last located by propfind
		let globals = 0;
		let objects = 0;
		let defprop = 0;
		let endText = 0;

		// Object-table layout (v3: 9-byte entries, 32 attrs; v4: 14-byte entries, 48 attrs).
		const v3 = this.version === 3;
		const objSize = v3 ? 9 : 14;
		const attrBytes = v3 ? 4 : 6;
		const parentOff = v3 ? 4 : 6;
		const siblingOff = v3 ? 5 : 8;
		const childOff = v3 ? 6 : 10;
		const propAddrOff = attrBytes + (v3 ? 3 : 6);
		const defaultPropCount = v3 ? 31 : 63;

		const initRng = (): void => {
			this.seed =
				this.initialSeed !== undefined
					? this.initialSeed >>> 0
					: (Math.random() * 0xffffffff) >>> 0;
		};

		const init = (): void => {
			mem = this.mem = new Memory(new Uint8Array(this.memInit), this.byteSwapped);
			bytes = mem.bytes;
			if (v3) {
				bytes[1]! &= 3;
				if (this.isTandy) bytes[1]! |= 8;
				if (!this.io.updateStatusLine) bytes[1]! |= 16;
				if (this.io.splitWindow && this.io.setWindow) bytes[1]! |= 32;
			} else {
				// v4 flags1: bit 2=bold, bit 3=italic, bit 4=fixed-pitch, bit 7=timed input.
				// We can render bold/italic/fixed via ANSI; timers not yet implemented.
				bytes[1]! = 0b0001_1100;
				// Header extras expected by v4 games.
				bytes[30] = 0; // interpreter number
				bytes[31] = 0; // interpreter version
				bytes[32] = 25; // screen height in lines
				bytes[33] = 80; // screen width in characters
			}
			mem.put(16, this.savedFlags);
			this.fwords = mem.getu(24);
			if (!this.vocabulary) this.vocabulary = new Vocabulary(mem, this.fwords, mem.getu(8));
			defprop = mem.getu(10) - 2;
			globals = mem.getu(12) - 32;
			cs = [];
			ds = [];
			pc = mem.getu(6);
			// objects[1] = objTableStart + defaultPropCount*2; objects + 1*objSize = that.
			objects = defprop + 2 + defaultPropCount * 2 - objSize;
			initRng();
		};

		const decode = (addr: number): string => {
			const r = decodeText(mem, this.fwords, addr);
			endText = r.end;
			return r.text;
		};

		// v3 packs addresses by 2 (shift 1); v4/v5 pack by 4 (shift 2).
		const packShift = this.version === 3 ? 1 : 2;
		const addr = (x: number): number => (x & 65535) << packShift;

		const pcgetb = (): number => bytes[pc++]!;
		const pcget = (): number => {
			pc += 2;
			return mem.get(pc - 2);
		};
		const pcfetch = (): number => fetch(bytes[pc++]!);

		const fetch = (x: number): number => {
			if (x === 0) return ds.pop()!;
			if (x < 16) return cs[0]!.local[x - 1]!;
			return mem.get(globals + 2 * x);
		};

		const xfetch = (x: number): number => {
			if (x === 0) return ds[ds.length - 1]!;
			if (x < 16) return cs[0]!.local[x - 1]!;
			return mem.get(globals + 2 * x);
		};

		const xstore = (x: number, y: number): void => {
			if (x === 0) ds[ds.length - 1] = y;
			else if (x < 16) cs[0]!.local[x - 1] = y;
			else mem.put(globals + 2 * x, y);
		};

		const store = (y: number): void => {
			const x = pcgetb();
			if (x === 0) ds.push(y);
			else if (x < 16) cs[0]!.local[x - 1] = y;
			else mem.put(globals + 2 * x, y);
		};

		const ret = (x: number): void => {
			ds = cs[0]!.ds;
			pc = cs[0]!.pc;
			cs.shift();
			store(x);
		};

		const predicate = (p: boolean | number): void => {
			let x = pcgetb();
			const flip = !!(x & 128);
			const truthy = !!p;
			const take = flip ? !truthy : truthy;
			if (x & 64) x &= 63;
			else x = ((x & 63) << 8) | pcgetb();
			if (take) return;
			if (x === 0 || x === 1) return ret(x);
			if (x & 0x2000) x -= 0x4000;
			pc += x - 2;
		};

		// Object-field accessors (1-byte in v3, 2-byte in v4).
		const objField = (obj: number, off: number): number =>
			v3 ? bytes[objects + obj * objSize + off]! : mem.getu(objects + obj * objSize + off);
		const setObjField = (obj: number, off: number, val: number): void => {
			if (v3) bytes[objects + obj * objSize + off] = val;
			else mem.putu(objects + obj * objSize + off, val);
		};
		const getParent = (obj: number): number => objField(obj, parentOff);
		const getSibling = (obj: number): number => objField(obj, siblingOff);
		const getChild = (obj: number): number => objField(obj, childOff);
		const setParent = (obj: number, val: number): void => setObjField(obj, parentOff, val);
		const setSibling = (obj: number, val: number): void => setObjField(obj, siblingOff, val);
		const setChild = (obj: number, val: number): void => setObjField(obj, childOff, val);
		const getPropAddr = (obj: number): number => mem.getu(objects + obj * objSize + propAddrOff);

		const flagset = (): void => {
			op3 = 1 << (15 & ~op1);
			// Attribute bits live in 16-bit words: word index = op1 >> 4.
			op2 = objects + op0 * objSize + (op1 >> 4) * 2;
			opc = mem.get(op2);
		};

		/**
		 * Decode a property header at `header`, writing its fields into `pNum`/`pSize`/
		 * `pDataOff` (scratch vars shared across calls to avoid a tuple allocation in
		 * the propfind hot path).
		 * v3: 1-byte header `(size-1)<<5 | num`, num in 1..31, size in 1..8.
		 * v4: 1 or 2-byte header. If high bit set, 2-byte form: [0x80|num][0xC0|size]
		 *     (with size==0 meaning 64). Else 1-byte form: bit 6 ⇒ size=2, else size=1.
		 */
		let pNum = 0, pSize = 0, pDataOff = 0;
		const propLayout = (header: number): void => {
			const b1 = bytes[header]!;
			if (v3) {
				pNum = b1 & 31;
				pSize = (b1 >> 5) + 1;
				pDataOff = 1;
				return;
			}
			pNum = b1 & 0x3f;
			if (b1 & 0x80) {
				pSize = (bytes[header + 1]! & 0x3f) || 64;
				pDataOff = 2;
			} else {
				pSize = b1 & 0x40 ? 2 : 1;
				pDataOff = 1;
			}
		};

		/** Size of the property whose data starts at `dataAddr`. */
		const propSizeAt = (dataAddr: number): number => {
			const back1 = bytes[(dataAddr - 1) & 65535]!;
			if (v3) return (back1 >> 5) + 1;
			// v4: if top bit set, dataAddr-1 is the 2nd size byte, header is at dataAddr-2.
			propLayout((back1 & 0x80 ? dataAddr - 2 : dataAddr - 1) & 65535);
			return pSize;
		};

		const propfind = (): boolean => {
			let z = getPropAddr(op0);
			z += bytes[z]! * 2 + 1; // skip short name (length prefix in words)
			while (bytes[z]) {
				propLayout(z);
				if (pNum === op1) {
					op3 = z + pDataOff;
					op3Size = pSize;
					return true;
				}
				z += pDataOff + pSize;
			}
			op3 = 0;
			op3Size = 0;
			return false;
		};

		const move = (x: number, y: number): void => {
			let w = 0;
			let z: number;
			if ((z = getParent(x))) {
				if (getChild(z) === x) {
					setChild(z, getSibling(x));
				} else {
					z = getChild(z);
					while (z !== x) {
						w = z;
						z = getSibling(z);
					}
					setSibling(w, getSibling(x));
				}
			}
			setParent(x, y);
			if (y) {
				setSibling(x, getChild(y));
				setChild(y, x);
			} else {
				setSibling(x, 0);
			}
		};

		// Hot path: rebuild-avoiding dispatch array for operand-type codes 0/1/2.
		const opDispatch: Array<() => number> = [pcget, pcgetb, pcfetch];
		const opfetch = (x: number, y: number): number => {
			if ((x &= 3) === 3) return 0; // operand omitted; opc unchanged
			opc = y;
			return opDispatch[x]!();
		};

		// Shared CALL-and-store logic for call_vs / call_1s / call_2s / call_vs2.
		// `opc` must already reflect the total operand count (routine + args).
		const doCall = (): void => {
			if (!op0) {
				store(0);
				return;
			}
			const fn = addr(op0);
			const localCount = bytes[fn]!;
			cs.unshift({ ds, pc, local: new Int16Array(localCount) });
			ds = [];
			pc = fn + 1;
			const locals = cs[0]!.local;
			for (let i = 0; i < localCount; i++) locals[i] = pcget();
			if (opc > 1 && localCount > 0) locals[0] = op1;
			if (opc > 2 && localCount > 1) locals[1] = op2;
			if (opc > 3 && localCount > 2) locals[2] = op3;
			if (opc > 4 && localCount > 3) locals[3] = op4;
			if (opc > 5 && localCount > 4) locals[4] = op5;
			if (opc > 6 && localCount > 5) locals[5] = op6;
			if (opc > 7 && localCount > 6) locals[6] = op7;
		};

		// Output-stream 3: redirected prints go to a memory table instead of the screen.
		// A stack supports nesting (up to 16 levels per spec). Each entry stores the
		// table's base address and write cursor.
		const stream3: Array<{ base: number; cursor: number }> = [];

		// Push current room/score/moves into the host-drawn status line (v3 only path;
		// ignored if the game draws its own via split_window). Called before READ and
		// READ_CHAR, and as the USL opcode.
		const refreshStatus = async (): Promise<void> => {
			if (!this.io.updateStatusLine) return;
			await this.io.updateStatusLine(
				decode(getPropAddr(xfetch(16)) + 1),
				xfetch(18),
				xfetch(17),
			);
		};

		// Flush text; flip highlight when (flags & 2) changes. While output stream 3 is
		// active, text is diverted into a memory buffer rather than reaching the screen.
		const genPrint = async (text: string): Promise<void> => {
			if (stream3.length > 0) {
				const top = stream3[stream3.length - 1]!;
				// v3/v4 store each printed character as a ZSCII byte (newline → 13).
				for (let i = 0; i < text.length; i++) {
					const c = text.charCodeAt(i);
					bytes[top.cursor++] = c === 10 ? 13 : c;
				}
				return;
			}
			const x = mem.get(16);
			if (x !== this.savedFlags) {
				this.savedFlags = x;
				if (this.io.highlight) await this.io.highlight(!!(x & 2));
			}
			await this.io.print(text, !!(x & 1));
		};

		// ─── init + restart hook ────────────────────────────────────────────
		init();
		if (this.io.restarted) await this.io.restarted();
		if (this.io.highlight) await this.io.highlight(!!(this.savedFlags & 2));

		// ─── main fetch/decode/execute loop ─────────────────────────────────
		for (;;) {
			let inst = pcgetb();
			if (inst < 128) {
				// 2OP
				if (inst & 64) op0 = pcfetch();
				else op0 = pcgetb();
				if (inst & 32) op1 = pcfetch();
				else op1 = pcgetb();
				inst &= 31;
				opc = 2;
			} else if (inst < 176) {
				// 1OP
				const x = (inst >> 4) & 3;
				inst &= 143;
				if (x === 0) op0 = pcget();
				else if (x === 1) op0 = pcgetb();
				else if (x === 2) op0 = pcfetch();
				opc = 1;
			} else if (inst >= 192) {
				// EXT (VAR / 2OP long form). call_vs2 (236) and call_vn2 (250) have
				// TWO operand-types bytes up front, both read before any operand bytes.
				const x = pcgetb();
				const isDouble = inst === 236 || inst === 250;
				const y = isDouble ? pcgetb() : 0;
				op0 = opfetch(x >> 6, 1);
				op1 = opfetch(x >> 4, 2);
				op2 = opfetch(x >> 2, 3);
				op3 = opfetch(x >> 0, 4);
				if (isDouble) {
					op4 = opfetch(y >> 6, 5);
					op5 = opfetch(y >> 4, 6);
					op6 = opfetch(y >> 2, 7);
					op7 = opfetch(y >> 0, 8);
				}
				if (inst < 224) inst &= 31;
			}

			let x: number;
			let z: Uint8Array | null | undefined;
			switch (inst) {
				case 1: // EQUAL?
					predicate(op0 === op1 || (opc > 2 && op0 === op2) || (opc === 4 && op0 === op3));
					break;
				case 2:
					predicate(op0 < op1);
					break; // LESS?
				case 3:
					predicate(op0 > op1);
					break; // GRTR?
				case 4: // DLESS?
					xstore(op0, (x = xfetch(op0) - 1));
					predicate(x < op1);
					break;
				case 5: // IGRTR?
					xstore(op0, (x = xfetch(op0) + 1));
					predicate(x > op1);
					break;
				case 6:
					predicate(getParent(op0) === op1);
					break; // IN?
				case 7:
					predicate((op0 & op1) === op1);
					break; // BTST
				case 8:
					store(op0 | op1);
					break; // BOR
				case 9:
					store(op0 & op1);
					break; // BAND
				case 10:
					flagset();
					predicate(!!(opc & op3));
					break; // FSET?
				case 11:
					flagset();
					mem.put(op2, opc | op3);
					break; // FSET
				case 12:
					flagset();
					mem.put(op2, opc & ~op3);
					break; // FCLEAR
				case 13:
					xstore(op0, op1);
					break; // SET
				case 14:
					move(op0, op1);
					break; // MOVE
				case 15:
					store(mem.get((op0 + op1 * 2) & 65535));
					break; // GET
				case 16:
					store(bytes[(op0 + op1) & 65535]!);
					break; // GETB
				case 17: // GETP
					if (propfind()) store(op3Size === 2 ? mem.get(op3) : bytes[op3]!);
					else store(mem.get(defprop + 2 * op1));
					break;
				case 18:
					propfind();
					store(op3);
					break; // GETPT
				case 19: // NEXTP
					if (op1) {
						// Advance past the current property's data to the next header, return num.
						propfind();
						const after = op3 + op3Size;
						if (bytes[after] === 0) store(0);
						else {
							propLayout(after);
							store(pNum);
						}
					} else {
						// First property of object op0.
						x = getPropAddr(op0);
						const first = x + bytes[x]! * 2 + 1;
						if (bytes[first] === 0) store(0);
						else {
							propLayout(first);
							store(pNum);
						}
					}
					break;
				case 20:
					store(op0 + op1);
					break; // ADD
				case 21:
					store(op0 - op1);
					break; // SUB
				case 22:
					store(Math.imul(op0, op1));
					break; // MUL
				case 23:
					store(Math.trunc(op0 / op1));
					break; // DIV
				case 24:
					store(op0 % op1);
					break; // MOD

				case 128:
					predicate(!op0);
					break; // ZERO?
				case 129: // NEXT?
					store((x = getSibling(op0)));
					predicate(x);
					break;
				case 130: // FIRST?
					store((x = getChild(op0)));
					predicate(x);
					break;
				case 131:
					store(getParent(op0));
					break; // LOC
				case 132:
					store(propSizeAt(op0));
					break; // PTSIZE
				case 133:
					x = xfetch(op0);
					xstore(op0, x + 1);
					break; // INC
				case 134:
					x = xfetch(op0);
					xstore(op0, x - 1);
					break; // DEC
				case 135:
					await genPrint(decode(op0 & 65535));
					break; // PRINTB
				case 137:
					move(op0, 0);
					break; // REMOVE
				case 138:
					await genPrint(decode(getPropAddr(op0) + 1));
					break; // PRINTD
				case 139:
					ret(op0);
					break; // RETURN
				case 140:
					pc += op0 - 2;
					break; // JUMP
				case 141:
					await genPrint(decode(addr(op0)));
					break; // PRINT
				case 142:
					store(xfetch(op0));
					break; // VALUE
				case 143:
					store(~op0);
					break; // BCOM

				case 176:
					ret(1);
					break; // RTRUE
				case 177:
					ret(0);
					break; // RFALSE
				case 178: // PRINTI
					await genPrint(decode(pc));
					pc = endText;
					break;
				case 179: // PRINTR
					await genPrint(decode(pc) + '\n');
					ret(1);
					break;
				case 180:
					break; // NOOP
				case 181: // SAVE
					this.savedFlags = mem.get(16);
					predicate(this.io.save ? await this.io.save(serialize(mem, ds, cs, pc)) : false);
					break;
				case 182: {
					// RESTORE
					this.savedFlags = mem.get(16);
					z = this.io.restore ? await this.io.restore() : null;
					const restored = z ? deserialize(mem, z) : null;
					mem.put(16, this.savedFlags);
					if (restored) {
						ds = restored[0];
						cs = restored[1];
						pc = restored[2];
					}
					predicate(!!restored);
					break;
				}
				case 183: // RESTART
					init();
					if (this.io.restarted) await this.io.restarted();
					break;
				case 184:
					ret(ds[ds.length - 1]!);
					break; // RSTACK
				case 185:
					ds.pop();
					break; // FSTACK
				case 186:
					return; // QUIT
				case 187:
					await genPrint('\n');
					break; // CRLF
				case 188: // USL
					await refreshStatus();
					break;
				case 189:
					predicate(this.verify());
					break; // VERIFY

				case 25: // call_2s (2OP:25) — call routine with 1 arg, store result
				case 224: // call_vs / call (VAR:224)
					doCall();
					break;
				case 136: // call_1s (1OP:136) — call routine with no args, store result
					doCall();
					break;
				case 236: // call_vs2 (VAR:236) — call with up to 7 args, store result
					doCall();
					break;
				case 225:
					mem.put((op0 + op1 * 2) & 65535, op2);
					break; // PUT
				case 226:
					bytes[(op0 + op1) & 65535] = op2;
					break; // PUTB
				case 227: // PUTP
					propfind();
					if (op3Size === 2) mem.put(op3, op2);
					else bytes[op3] = op2;
					break;
				case 228: // READ
					await genPrint('');
					await refreshStatus();
					this.vocabulary!.handleInput(
						mem,
						await this.io.read(bytes[op0 & 65535]!),
						op0 & 65535,
						op1 & 65535
					);
					break;
				case 229: // PRINTC
					await genPrint(op0 === 13 ? '\n' : op0 ? String.fromCharCode(op0) : '');
					break;
				case 230:
					await genPrint(String(op0));
					break; // PRINTN
				case 231: // RANDOM
					if (op0 <= 0) {
						if (op0 === 0) initRng();
						else this.seed = op0 >>> 0;
						store(0);
						break;
					}
					this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0;
					store(Math.floor((this.seed / 0xffffffff) * op0) + 1);
					break;
				case 232:
					ds.push(op0);
					break; // PUSH
				case 233:
					xstore(op0, ds.pop()!);
					break; // POP
				case 234: // split_window
					if (this.io.splitWindow) await this.io.splitWindow(op0);
					break;
				case 235: // set_window
					if (this.io.setWindow) await this.io.setWindow(op0);
					break;

				case 237: // erase_window
					if (this.io.eraseWindow) await this.io.eraseWindow((op0 << 16) >> 16);
					break;
				case 238: // erase_line
					if (this.io.eraseLine) await this.io.eraseLine(op0);
					break;
				case 239: // set_cursor y x
					if (this.io.setCursor) await this.io.setCursor(op0, op1);
					break;
				case 240: { // get_cursor → [y, x] written to table at op0
					const [y, x] = this.io.getCursor?.() ?? [1, 1];
					mem.putu(op0 & 65535, y);
					mem.putu((op0 + 2) & 65535, x);
					break;
				}
				case 241: // set_text_style
					if (this.io.setTextStyle) await this.io.setTextStyle(op0);
					break;
				case 242: // buffer_mode — 0 = unbuffered, non-zero = buffered
					if (this.io.bufferMode) await this.io.bufferMode(op0 !== 0);
					break;
				case 245: // sound_effect — not yet implemented
					break;

				case 243: { // output_stream
					const sid = op0 << 16 >> 16; // sign-extend to int16
					if (sid === 3) {
						// Open memory stream; op1 = table address. Reserve first 2 bytes for length.
						stream3.push({ base: op1, cursor: op1 + 2 });
					} else if (sid === -3) {
						// Close top memory stream; write length back to the first 2 bytes.
						const top = stream3.pop();
						if (top) mem.putu(top.base, top.cursor - top.base - 2);
					}
					// Streams 1, 2, 4 not yet implemented; silently ignore.
					break;
				}

				case 244: // input_stream — no-op, we only read from the keyboard
					break;

				case 246: { // read_char — read a single keypress, return its ZSCII code
					await genPrint('');
					await refreshStatus();
					const s = await this.io.read(1);
					store(s.length > 0 ? s.charCodeAt(0) : 13);
					break;
				}

				case 247: { // scan_table
					// op0 = value, op1 = table, op2 = length, op3 = form (v5+; default 0x82)
					const form = opc >= 4 ? op3 : 0x82;
					const isWord = !!(form & 0x80);
					const entrySize = form & 0x7f;
					const needle = op0 & 0xffff;
					let found = 0;
					for (let i = 0; i < op2; i++) {
						const a = (op1 + i * entrySize) & 0xffff;
						const v = isWord ? mem.getu(a) : bytes[a]!;
						if (v === needle) {
							found = a;
							break;
						}
					}
					store(found);
					predicate(found);
					break;
				}

				default:
					throw new Error(`ZMachine: invalid opcode ${inst} at pc=${pc - 1}`);
			}
		}
	}
}
