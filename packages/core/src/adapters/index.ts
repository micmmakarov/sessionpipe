// SPDX-License-Identifier: Apache-2.0
// The registry: the only place that lists vendors. A new harness is one file here
// plus its fixtures and its row in spec/ADAPTERS.md.
import { antigravity } from "./antigravity.js";
import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import { geminiCli } from "./gemini-cli.js";
import type { Adapter } from "./types.js";

export const ADAPTERS: readonly Adapter[] = [claudeCode, codex, geminiCli, antigravity];
export const adapterByName = (name: string): Adapter | undefined => ADAPTERS.find((a) => a.name === name);
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
