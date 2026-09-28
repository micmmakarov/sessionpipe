import type { TranscriptRead } from "../adapters/types.js";

interface Msg {
  role: "user" | "assistant";
  text: string;
  at: number;
  line: number;
}
export declare function pairTurns(msgs: Msg[], endLine: number): TranscriptRead;
/** Injected context the person never typed: <tag>…</tag> wrappers, HTML comments, slash-command expansions. */
export declare const isInjected: (text: string) => boolean;
/** Claude Code / Droid: {type:"user"|"assistant", message:{content}, timestamp, isMeta, isSidechain, origin}. */
export declare function readClaude(lines: string[], from: number): TranscriptRead;
/** Codex rollout: {type:"response_item", payload:{type:"message", role, content:[{type:"input_text"|"output_text", text}]}}. */
export declare function readCodex(lines: string[], from: number): TranscriptRead;
/** Gemini CLI chat log: {type:"user"|"gemini", content|message|text, timestamp}. */
export declare function readGemini(lines: string[], from: number): TranscriptRead;
/** Antigravity: one step per line, type USER_INPUT | PLANNER_RESPONSE, content with <USER_REQUEST> wrapping. */
export declare function readAntigravity(lines: string[], from: number): TranscriptRead;
//# sourceMappingURL=transcripts.d.ts.map
