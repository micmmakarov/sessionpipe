/** The first and last bytes of a file, as lines — a transcript can be tens of MB. */
export declare function ends(
  file: string,
  headBytes: number,
  tailBytes: number,
): {
  head: string[];
  tail: string[];
};
export declare const parseLines: (lines: string[]) => Record<string, unknown>[];
/** Read line by line up to `cap` bytes, stopping when `visit` returns a value. */
export declare function scanLines<T>(file: string, visit: (line: string) => T | null, cap?: number): T | null;
export declare function recentFiles(
  root: string,
  depth: number,
  sinceMs: number,
  match: (name: string) => boolean,
): string[];
//# sourceMappingURL=files.d.ts.map
