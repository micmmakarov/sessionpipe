import type { Adapter, FactsState, SessionFacts } from "./types.js";
export declare const CLAUDE_EVENTS: readonly [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "Notification",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "SessionEnd",
];
/** Every Claude Code config dir on this machine. */
export declare function claudeDirs(env?: NodeJS.ProcessEnv, home?: string): string[];
export declare const claudeCode: Adapter;
/** The Claude Code process that ran this hook: the nearest ancestor with a registry
 *  file (hooks run under a shell, so usually the parent's parent). */
export declare function claudePid(env?: NodeJS.ProcessEnv): number | null;
/** A first ask as the Claude Code app titles an untitled session: whitespace
 *  collapsed, whole up to 50 characters, else its first 50 and "...". */
export declare function appTitle(text: string): string;
/** A session's title and where it came from, best first: /rename (registry "user"
 *  name or custom-title) → Claude Code's own title (registry "auto" name or
 *  ai-title) → the first ask, marked first-ask so a real title later replaces it. */
export declare function claudeFacts(
  file: string,
  sessionId: string,
  hints: Record<string, unknown>,
  state: FactsState,
): SessionFacts;
/** For tests: each hook runs in a fresh process; a test that edits the registry mid-run clears the cache. */
export declare const _resetClaudeCaches: () => void;
//# sourceMappingURL=claude-code.d.ts.map
