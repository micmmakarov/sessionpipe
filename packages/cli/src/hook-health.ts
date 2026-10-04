// SPDX-License-Identifier: Apache-2.0
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/** Timing includes throttled hooks too. Stream the log so a busy machine's history
 *  does not need to fit in memory. This is evidence of blocking, not proof: a tool
 *  can also hang, so give recent starts a minute to complete. */
export async function hookHealthWarnings(file: string, now = Date.now()): Promise<string[]> {
  const since = now - 24 * 60 * 60 * 1000;
  let pre = 0;
  let post = 0;
  try {
    const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of lines) {
      try {
        const beat = JSON.parse(line) as { harness?: string; event?: string; at?: number } | null;
        if (beat?.harness !== "antigravity" || typeof beat.at !== "number") continue;
        if (!Number.isFinite(beat.at) || beat.at < since || beat.at > now) continue;
        if (beat.event === "PreToolUse" && beat.at <= now - 60_000) pre++;
        if (beat.event === "PostToolUse") post++;
      } catch {
        // A partial or corrupt line must not hide the rest of the evidence.
      }
    }
  } catch {
    return [];
  }
  return pre > 0 && post === 0
    ? [
        `antigravity: timing.jsonl recorded ${pre} PreToolUse hook(s) at least a minute old and zero PostToolUse in the last 24 hours; hooks are likely blocking tool calls. Run \`sessionpipe install\` to remove sessionpipe's PreToolUse entry, then restart Antigravity.`,
      ]
    : [];
}
