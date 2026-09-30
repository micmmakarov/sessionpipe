#!/usr/bin/env node
// Experiment 3: a Stop hook that delivers a queued prompt as {"decision":"block"}.
// Logs every call so we can see whether stop_hook_active prevents a loop.
import { appendFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const log = process.env.SPIKE_LOG || "/tmp/stop-block.log";
appendFileSync(log, JSON.stringify({ at: Date.now(), active: input.stop_hook_active, sid: input.session_id }) + "\n");
const q = process.env.SPIKE_QUEUE;
if (q && existsSync(q) && !input.stop_hook_active) {
  const text = readFileSync(q, "utf8");
  unlinkSync(q);
  process.stdout.write(JSON.stringify({ decision: "block", reason: text }));
}
