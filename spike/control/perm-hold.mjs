#!/usr/bin/env node
// Experiment 2: a PermissionRequest hook that holds the request open, waiting for a
// signed answer (here: a file appearing) for up to SPIKE_WAIT_S seconds.
import { appendFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const log = process.env.SPIKE_LOG;
const ans = process.env.SPIKE_ANSWER;
const t0 = Date.now();
const note = (o) => appendFileSync(log, JSON.stringify({ at: Date.now(), ms: Date.now() - t0, ...o }) + "\n");
note({ ev: "start", tool: input.tool_name, keys: Object.keys(input) });
process.on("SIGTERM", () => {
  note({ ev: "sigterm" });
  process.exit(0);
});
process.on("SIGINT", () => {
  note({ ev: "sigint" });
  process.exit(0);
});
process.on("SIGHUP", () => {
  note({ ev: "sighup" });
  process.exit(0);
});
const limit = Number(process.env.SPIKE_WAIT_S || 60) * 1000;
const tick = setInterval(() => {
  if (existsSync(ans)) {
    const behavior = readFileSync(ans, "utf8").trim();
    unlinkSync(ans);
    note({ ev: "answer", behavior });
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PermissionRequest",
          decision: { behavior, message: behavior === "deny" ? "Denied from the phone." : undefined },
        },
      }),
    );
    clearInterval(tick);
    process.exit(0);
  }
  if (Date.now() - t0 > limit) {
    note({ ev: "timeout" });
    clearInterval(tick);
    process.exit(0);
  }
}, 100);
