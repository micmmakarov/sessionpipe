// SPDX-License-Identifier: Apache-2.0
// file:PATH — append filtered events as JSONL. The zero-server sink.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Event, Tier } from "../types.js";
import type { DeliveryResult, Sink } from "./types.js";

export class FileSink implements Sink {
  constructor(
    readonly name: string,
    readonly file: string,
    readonly tier: Tier,
    readonly pii: boolean,
  ) {}
  async send(events: Event[]): Promise<DeliveryResult> {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      appendFileSync(this.file, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
      return { ok: true, acknowledged: events.length, accepted: events.length, duplicates: 0, rejected: [] };
    } catch (e) {
      return { ok: false, acknowledged: 0, error: String((e as Error).message), action: "retry" };
    }
  }
}
