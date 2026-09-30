#!/usr/bin/env node
// Experiment 1: `sessionpipe wait`. Parks on the daemon's socket and exits only when
// a message arrives (printing it) or when SPIKE_MAX_S passes (asking to be re-run).
// A daemon restart is a reconnect, never an exit: exiting wakes the model.
import { connect } from "node:net";

const [sid] = process.argv.slice(2);
const sock = process.env.SPIKE_SOCK;
const until = Date.now() + Number(process.env.SPIKE_MAX_S || 7000) * 1000;
function park() {
  if (Date.now() > until) {
    console.log("No message yet. Run this same command again in the background to keep listening.");
    process.exit(0);
  }
  const c = connect(sock);
  let buf = "",
    done = false;
  c.on("connect", () => c.write(JSON.stringify({ op: "wait", session: sid }) + "\n"));
  c.on("data", (d) => {
    buf += d;
  });
  c.on("end", () => {
    if (!buf.trim()) return;
    done = true;
    const { text } = JSON.parse(buf);
    console.log(
      `Message from the person who owns this session (sent from the spacesheep page):\n\n${text}\n\nAnswer it here, then run this same command again in the background to keep listening.`,
    );
    process.exit(0);
  });
  c.on("error", () => {});
  c.on("close", () => {
    if (!done) setTimeout(park, 1000);
  });
}
setTimeout(() => {
  console.log("No message yet. Run this same command again in the background to keep listening.");
  process.exit(0);
}, until - Date.now()).unref?.();
park();
