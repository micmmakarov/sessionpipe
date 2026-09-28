import type { Adapter, SessionFacts } from "./types.js";
export declare const CODEX_EVENTS: readonly [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Stop",
  "Interrupt",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "SessionEnd",
];
export declare const codex: Adapter;
/** Codex keeps no title; its first real ask stands in. */
export declare function codexFacts(file: string): SessionFacts;
//# sourceMappingURL=codex.d.ts.map
