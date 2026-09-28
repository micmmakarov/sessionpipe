// SPDX-License-Identifier: Apache-2.0
// The drain packs events from many sessions into one batch and moves every
// cursor only after the batch was acknowledged.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Cursors, type Event, Outbox, ulid } from "@sessionpipe/core";
import { afterEach, describe, expect, it } from "vitest";
import { flush } from "../src/run.js";

const tmp = mkdtempSync(path.join(os.tmpdir(), "sp-flush-"));
afterEach(() => rmSync(tmp, { recursive: true, force: true }));
const ev = (session: string, seq: number, type = "session.heartbeat"): Event => ({
  protocol: 1,
  id: ulid(),
  type,
  time: new Date().toISOString(),
  tier: 3,
  harness: { name: "codex" },
  session: { id: session, seq },
  privacy: { rulesets: [], pii: false },
  data: type === "tool.ended" ? { tool: "Bash", ok: true } : {},
});

describe("flush", () => {
  it("packs 120 events from 30 sessions into 3 batches and advances every cursor", async () => {
    const outbox = new Outbox(tmp);
    for (let s = 0; s < 30; s++)
      outbox.append(
        { harness: "codex", session: `s${s}` },
        [0, 1, 2, 3].map((i) => ev(`s${s}`, i)),
      );
    const file = path.join(tmp, "out.jsonl");
    const d = await flush(tmp, [{ name: "f", url: `file:${file}`, tier: 0 }], outbox);
    expect(d.f).toBe(120);
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(120);
    const c = new Cursors(tmp, "f").read();
    expect(Object.keys(c)).toHaveLength(30);
    // A second flush sends nothing.
    expect((await flush(tmp, [{ name: "f", url: `file:${file}`, tier: 0 }], outbox)).f).toBe(0);
  });
  it("a tier-0 sink whose events all filter away still moves its cursors", async () => {
    const outbox = new Outbox(tmp);
    outbox.append({ harness: "codex", session: "t" }, [ev("t", 0, "tool.ended"), ev("t", 1, "tool.ended")]);
    const file = path.join(tmp, "out0.jsonl");
    const d = await flush(tmp, [{ name: "z", url: `file:${file}`, tier: 0 }], outbox);
    expect(d.z).toBe(0);
    expect(new Cursors(tmp, "z").read()["codex/t"]).toBeGreaterThan(0);
  });
});
