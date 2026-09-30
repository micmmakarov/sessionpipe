#!/usr/bin/env node
import { appendFileSync, rmSync } from "node:fs";
// Experiment 1: the daemon's local half. A Unix socket where waiters park by
// session id; `node daemon-stub.mjs send <sid> <text>` hands one a message.
import { connect, createServer } from "node:net";

const sock = process.env.SPIKE_SOCK;
const log = (o) => appendFileSync(process.env.SPIKE_LOG, JSON.stringify({ at: Date.now(), ...o }) + "\n");
if (process.argv[2] === "send") {
  const c = connect(sock, () =>
    c.end(JSON.stringify({ op: "send", session: process.argv[3], text: process.argv.slice(4).join(" ") }) + "\n"),
  );
  c.on("data", (d) => process.stdout.write(d));
} else {
  rmSync(sock, { force: true });
  const waiters = new Map();
  createServer((c) => {
    let buf = "";
    c.on("data", (d) => {
      buf += d;
      if (!buf.includes("\n")) return;
      const m = JSON.parse(buf.slice(0, buf.indexOf("\n")));
      if (m.op === "wait") {
        waiters.set(m.session, c);
        log({ ev: "parked", session: m.session });
        c.on("close", () => {
          if (waiters.get(m.session) === c) waiters.delete(m.session);
          log({ ev: "gone", session: m.session });
        });
      }
      if (m.op === "send") {
        const w = waiters.get(m.session);
        if (!w) {
          c.end("no waiter\n");
          return;
        }
        w.end(JSON.stringify({ text: m.text }) + "\n");
        waiters.delete(m.session);
        log({ ev: "delivered", session: m.session });
        c.end("delivered via waiter\n");
      }
    });
  }).listen(sock, () => log({ ev: "listening" }));
}
