import { antigravity } from "./antigravity.js";
import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import { geminiCli } from "./gemini-cli.js";
import type { Adapter } from "./types.js";
export declare const ADAPTERS: readonly Adapter[];
export declare const adapterByName: (name: string) => Adapter | undefined;
export type {
  Adapter,
  AdapterEvent,
  BackfillRow,
  FactsState,
  HookCommand,
  HookInput,
  HookResult,
  InstallReport,
  SessionFacts,
  TranscriptRead,
  Turn,
} from "./types.js";
export { antigravity, claudeCode, codex, geminiCli };
//# sourceMappingURL=index.d.ts.map
