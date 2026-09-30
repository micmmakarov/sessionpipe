#!/usr/bin/env node
// Experiment 4: the daemon starts a session with the Agent SDK and feeds it through
// streaming input. Measures idle cost (messages while nobody writes) and time from
// a pushed message to the first streamed token.
import { query } from "@anthropic-ai/claude-agent-sdk";

const IDLE_MS = Number(process.env.SPIKE_IDLE_MS || 60000);
let push;
const inbox = [];
async function* input() {
  while (true) {
    while (inbox.length) yield inbox.shift();
    await new Promise((r) => {
      push = r;
    });
  }
}
const send = (text) => {
  inbox.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, session_id: "" });
  push?.();
};
const q = query({
  prompt: input(),
  options: { model: "haiku", includePartialMessages: true, permissionMode: "dontAsk" },
});
let sentAt = 0,
  firstTok = null,
  sid = null,
  idleMsgs = 0,
  idle = false,
  round = 0;
const t0 = Date.now();
send("Reply with the single word READY.");
sentAt = Date.now();
for await (const m of q) {
  if (m.session_id) sid = m.session_id;
  if (idle) idleMsgs++;
  if (m.type === "stream_event" && firstTok === null && m.event?.type === "content_block_delta") {
    firstTok = Date.now() - sentAt;
  }
  if (m.type === "result") {
    round++;
    console.log(
      JSON.stringify({ round, first_token_ms: firstTok, result_ms: Date.now() - sentAt, result: m.result, sid }),
    );
    if (round === 1) {
      idle = true;
      await new Promise((r) => setTimeout(r, IDLE_MS));
      idle = false;
      console.log(JSON.stringify({ idle_ms: IDLE_MS, messages_while_idle: idleMsgs }));
      firstTok = null;
      sentAt = Date.now();
      send("A message from the phone: what is 12 times 12? Reply SDK: and the number.");
    } else {
      q.interrupt?.();
      break;
    }
  }
}
console.log(JSON.stringify({ total_ms: Date.now() - t0 }));
process.exit(0);
