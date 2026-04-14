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
export class ZMachine {
	readonly memInit: Uint8Array;
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
		if (bytes[0] !== 3) throw new Error('Unsupported Z-code version.');
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
			op3 = 0;
		let opc = 0;
		let globals = 0;
		let objects = 0;
		let defprop = 0;
		let endText = 0;

		const initRng = (): void => {
			this.seed =
				this.initialSeed !== undefined
					? this.initialSeed >>> 0
					: (Math.random() * 0xffffffff) >>> 0;
		};

		const init = (): void => {
			mem = this.mem = new Memory(new Uint8Array(this.memInit), this.byteSwapped);
			bytes = mem.bytes;
			bytes[1]! &= 3;
			if (this.isTandy) bytes[1]! |= 8;
			if (!this.io.updateStatusLine) bytes[1]! |= 16;
			if (this.io.screen && this.io.split) bytes[1]! |= 32;
			mem.put(16, this.savedFlags);
			this.fwords = mem.getu(24);
			if (!this.vocabulary) this.vocabulary = new Vocabulary(mem, this.fwords, mem.getu(8));
			defprop = mem.getu(10) - 2;
			globals = mem.getu(12) - 32;
			cs = [];
			ds = [];
			pc = mem.getu(6);
			objects = defprop + 55;
			initRng();
		};

		const decode = (addr: number): string => {
			const r = decodeText(mem, this.fwords, addr);
			endText = r.end;
			return r.text;
		};

		const addr = (x: number): number => (x & 65535) << 1;

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

		const flagset = (): void => {
			op3 = 1 << (15 & ~op1);
			op2 = objects + op0 * 9 + (op1 & 16 ? 2 : 0);
			opc = mem.get(op2);
		};

		const propfind = (): boolean => {
			let z = mem.getu(objects + op0 * 9 + 7);
			z += bytes[z]! * 2 + 1;
			while (bytes[z]) {
				if ((bytes[z]! & 31) === op1) {
					op3 = z + 1;
					return true;
				} else {
					z += (bytes[z]! >> 5) + 2;
				}
			}
			op3 = 0;
			return false;
		};

		const move = (x: number, y: number): void => {
			let w = 0;
			let z: number;
			if ((z = bytes[objects + x * 9 + 4]!)) {
				if (bytes[objects + z * 9 + 6]! === x) {
					bytes[objects + z * 9 + 6] = bytes[objects + x * 9 + 5]!;
				} else {
					z = bytes[objects + z * 9 + 6]!;
					while (z !== x) {
						w = z;
						z = bytes[objects + z * 9 + 5]!;
					}
					bytes[objects + w * 9 + 5] = bytes[objects + x * 9 + 5]!;
				}
			}
			bytes[objects + x * 9 + 4] = y;
			if (y) {
				bytes[objects + x * 9 + 5] = bytes[objects + y * 9 + 6]!;
				bytes[objects + y * 9 + 6] = x;
			} else {
				bytes[objects + x * 9 + 5] = 0;
			}
		};

		const opfetch = (x: number, y: number): number | undefined => {
			if ((x &= 3) === 3) return;
			opc = y;
			return [pcget, pcgetb, pcfetch][x]!();
		};

		// Flush text; flip highlight when (flags & 2) changes.
		const genPrint = async (text: string): Promise<void> => {
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
			} else if (inst >= 192) {
				// EXT
				const x = pcgetb();
				op0 = opfetch(x >> 6, 1) as number;
				op1 = opfetch(x >> 4, 2) as number;
				op2 = opfetch(x >> 2, 3) as number;
				op3 = opfetch(x >> 0, 4) as number;
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
					predicate(bytes[objects + op0 * 9 + 4] === op1);
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
					if (propfind()) store(bytes[op3 - 1]! & 32 ? mem.get(op3) : bytes[op3]!);
					else store(mem.get(defprop + 2 * op1));
					break;
				case 18:
					propfind();
					store(op3);
					break; // GETPT
				case 19: // NEXTP
					if (op1) {
						propfind();
						store(bytes[op3 + (bytes[op3 - 1]! >> 5) + 1]! & 31);
					} else {
						x = mem.getu(objects + op0 * 9 + 7);
						store(bytes[x + bytes[x]! * 2 + 1]! & 31);
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
					store((x = bytes[objects + op0 * 9 + 5]!));
					predicate(x);
					break;
				case 130: // FIRST?
					store((x = bytes[objects + op0 * 9 + 6]!));
					predicate(x);
					break;
				case 131:
					store(bytes[objects + op0 * 9 + 4]!);
					break; // LOC
				case 132:
					store((bytes[(op0 - 1) & 65535]! >> 5) + 1);
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
					await genPrint(decode(mem.getu(objects + op0 * 9 + 7) + 1));
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
					if (this.io.updateStatusLine) {
						await this.io.updateStatusLine(
							decode(mem.getu(objects + xfetch(16) * 9 + 7) + 1),
							xfetch(18),
							xfetch(17)
						);
					}
					break;
				case 189:
					predicate(this.verify());
					break; // VERIFY

				case 224: {
					// CALL
					if (op0) {
						const fn = addr(op0);
						const localCount = bytes[fn]!;
						cs.unshift({ ds, pc, local: new Int16Array(localCount) });
						ds = [];
						pc = fn + 1;
						for (let i = 0; i < localCount; i++) cs[0]!.local[i] = pcget();
						if (opc > 1 && localCount > 0) cs[0]!.local[0] = op1;
						if (opc > 2 && localCount > 1) cs[0]!.local[1] = op2;
						if (opc > 3 && localCount > 2) cs[0]!.local[2] = op3;
					} else {
						store(0);
					}
					break;
				}
				case 225:
					mem.put((op0 + op1 * 2) & 65535, op2);
					break; // PUT
				case 226:
					bytes[(op0 + op1) & 65535] = op2;
					break; // PUTB
				case 227: // PUTP
					propfind();
					if (bytes[op3 - 1]! & 32) mem.put(op3, op2);
					else bytes[op3] = op2;
					break;
				case 228: // READ
					await genPrint('');
					if (this.io.updateStatusLine) {
						await this.io.updateStatusLine(
							decode(mem.getu(objects + xfetch(16) * 9 + 7) + 1),
							xfetch(18),
							xfetch(17)
						);
					}
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
				case 234:
					if (this.io.split) await this.io.split(op0);
					break; // SPLIT
				case 235:
					if (this.io.screen) await this.io.screen(op0);
					break; // SCREEN
				default:
					throw new Error(`ZMachine: invalid opcode ${inst} at pc=${pc - 1}`);
			}
		}
	}
}
