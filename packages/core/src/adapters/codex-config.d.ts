/** A notify that runs sessionpipe's hook directly. */
export declare const OURS: RegExp;
/** Offset of the first table header, or -1. */
export declare function firstTableAt(text: string): number;
export declare function parseArgv(raw: string): string[] | null;
export interface Notify {
  raw: string;
  argv: string[] | null;
  index: number;
  length: number;
  misplaced: boolean;
  other: boolean;
}
/** notify as Codex sees it; `misplaced` for a line of ours inside a table. */
export declare function readNotify(text: string): Notify | null;
/** Put `line` at the top level: before the first table, or at the end of a file that has none. */
export declare function insertTopLevel(text: string, line: string): string;
/** The config with `line` as its notify, for a config whose notify is ours or absent. */
export declare function withNotify(text: string, line: string): string;
/** The config with its top-level notify line replaced by `line`. */
export declare function replaceNotify(text: string, line: string): string | null;
/** The config with our top-level or misplaced notify removed. */
export declare function withoutNotify(text: string): string;
export declare function previousNotify(argv: string[] | null): string[] | null;
export declare function withPrevious(argv: string[], prev: string[] | null): string[];
export declare const isComputerUse: (argv: string[] | null) => boolean;
//# sourceMappingURL=codex-config.d.ts.map
