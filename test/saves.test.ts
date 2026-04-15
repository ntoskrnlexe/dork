import { test, expect } from 'bun:test';
import { Memory } from '../src/zmachine/memory.ts';
import { serialize, deserialize, type CallFrame } from '../src/zmachine/saves.ts';

function makeMem(purbot = 0x40): Memory {
	const buf = new Uint8Array(512);
	buf[0] = 5; // version
	buf[2] = 0xab;
	buf[3] = 0xcd; // zorkid
	// static memory base at header 14..15 ("purbot" = high end of dynamic memory)
	buf[14] = purbot >> 8;
	buf[15] = purbot & 0xff;
	return new Memory(buf, false);
}

test('serialize/deserialize round-trip preserves argCount per frame', () => {
	const mem = makeMem();
	const cs: CallFrame[] = [
		{ local: Int16Array.from([10, 20, 30]), pc: 0x1234, ds: [1, 2], discardResult: false, argCount: 2 },
		{ local: Int16Array.from([7]), pc: 0x5678, ds: [], discardResult: true, argCount: 1 },
	];
	const ds = [99, 100];
	const bytes = serialize(mem, ds, cs, 0xdead);

	const out = deserialize(mem, bytes);
	expect(out).not.toBeNull();
	const [rds, rcs, rpc] = out!;
	expect(rpc).toBe(0xdead);
	expect(rds).toEqual([99, 100]);
	expect(rcs).toHaveLength(2);
	expect(rcs[0]!.argCount).toBe(2);
	expect(rcs[0]!.discardResult).toBe(false);
	expect(rcs[0]!.pc).toBe(0x1234);
	expect(Array.from(rcs[0]!.local)).toEqual([10, 20, 30]);
	expect(rcs[1]!.argCount).toBe(1);
	expect(rcs[1]!.discardResult).toBe(true);
});

test('argCount of 0 round-trips', () => {
	const mem = makeMem();
	const cs: CallFrame[] = [
		{ local: Int16Array.from([0, 0, 0]), pc: 0x100, ds: [], discardResult: false, argCount: 0 },
	];
	const out = deserialize(mem, serialize(mem, [], cs, 0));
	expect(out).not.toBeNull();
	expect(out![1][0]!.argCount).toBe(0);
});
