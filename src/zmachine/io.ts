export interface ZMachineIO {
	print(text: string, scripting: boolean): Promise<void> | void;
	read(maxlen: number): Promise<string> | string;
	save?(buf: Uint8Array): Promise<boolean> | boolean;
	restore?(): Promise<Uint8Array | null | undefined> | Uint8Array | null | undefined;
	restarted?(): Promise<void> | void;
	highlight?(fixpitch: boolean): Promise<void> | void;

	/** v3 auto-drawn status line. When defined, the header NO-STATUS flag stays clear. */
	updateStatusLine?(text: string, v18: number, v17: number): Promise<void> | void;

	// v4+ windowing and styling.
	splitWindow?(lines: number): Promise<void> | void;
	setWindow?(window: number): Promise<void> | void;
	eraseWindow?(window: number): Promise<void> | void;
	eraseLine?(value: number): Promise<void> | void;
	setCursor?(y: number, x: number): Promise<void> | void;
	/** Returns 1-indexed [y, x] of the upper-window cursor. */
	getCursor?(): readonly [number, number];
	setTextStyle?(style: number): Promise<void> | void;
	bufferMode?(buffering: boolean): Promise<void> | void;
}
