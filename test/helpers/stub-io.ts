import type { ZMachineIO } from '../../src/zmachine/index.ts';

export interface StubIOOptions {
	/** Handler invoked on each READ. Throw to stop the interpreter. */
	read: () => string;
}

/**
 * A minimal ZMachineIO with no-op stubs for all optional window/style hooks.
 * The required `print` captures into a mutable buffer; `read` is delegated to
 * the caller. Used by the conformance test suites that don't need a full
 * scripted conversation.
 */
export function makeStubIO(opts: StubIOOptions): { io: ZMachineIO; output: { value: string } } {
	const output = { value: '' };
	const io: ZMachineIO = {
		print(t) {
			output.value += t;
		},
		read: opts.read,
		splitWindow() {},
		setWindow() {},
		setCursor() {},
		setTextStyle() {},
		bufferMode() {},
		setColour() {},
		eraseWindow() {},
		eraseLine() {},
		getCursor(): readonly [number, number] {
			return [1, 1] as const;
		},
	};
	return { io, output };
}
