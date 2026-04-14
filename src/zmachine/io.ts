export interface ZMachineIO {
	print(text: string, scripting: boolean): Promise<void> | void;
	read(maxlen: number): Promise<string> | string;
	save?(buf: Uint8Array): Promise<boolean> | boolean;
	restore?(): Promise<Uint8Array | null | undefined> | Uint8Array | null | undefined;
	restarted?(): Promise<void> | void;
	highlight?(fixpitch: boolean): Promise<void> | void;
	updateStatusLine?(text: string, v18: number, v17: number): Promise<void> | void;
	screen?(window: number): Promise<void> | void;
	split?(height: number): Promise<void> | void;
}
