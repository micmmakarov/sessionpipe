// SPDX-License-Identifier: Apache-2.0
// stdout — one JSON line per event to a writable (the worker's stdout is ignored
// when spawned by a hook, so this sink is for `sessionpipe tail` and tests).
import type { Event, Tier } from "../types.js";
import type { DeliveryResult, Sink } from "./types.js";

export class StdoutSink implements Sink {
  constructor(
    readonly name: string,
    readonly tier: Tier,
    readonly pii: boolean,
    private readonly write: (line: string) => void = (l) => process.stdout.write(`${l}\n`),
  ) {}
  async send(events: Event[]): Promise<DeliveryResult> {
    for (const e of events) this.write(JSON.stringify(e));
    return { ok: true, acknowledged: events.length, accepted: events.length, duplicates: 0, rejected: [] };
  }
}
