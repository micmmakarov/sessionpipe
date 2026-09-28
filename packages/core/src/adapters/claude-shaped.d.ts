import type { HookCommand, InstallReport } from "./types.js";
export interface ClaudeShapedOptions {
  /** Which events take a `matcher` (tool and permission events). */
  matcherFor: (event: string) => string | undefined;
  /** Seconds. */
  timeout: number;
  /** Extra top-level keys the file must carry (Cursor/Copilot: version: 1). */
  top?: Record<string, unknown>;
}
export declare const OURS: RegExp;
export declare const isOurs: (h: {
  hooks?: {
    command?: string;
  }[];
}) => boolean;
export declare function readJson(file: string): Record<string, unknown>;
export declare function installClaudeShaped(
  file: string,
  harness: string,
  events: readonly string[],
  cmd: HookCommand,
  o: ClaudeShapedOptions,
): InstallReport;
export declare function uninstallClaudeShaped(file: string, events: readonly string[]): InstallReport;
export declare function installedClaudeShaped(
  file: string,
  harness: string,
  events: readonly string[],
  cmd: HookCommand,
  o: ClaudeShapedOptions,
): "current" | "stale" | "missing";
//# sourceMappingURL=claude-shaped.d.ts.map
