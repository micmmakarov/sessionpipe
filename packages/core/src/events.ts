// SPDX-License-Identifier: Apache-2.0
// From an adapter's output to a protocol event: id, time, the full session block
// as known now, and the raw (tier 3) data. Filtering per sink happens later.
import type { AdapterEvent } from "./adapters/types.js";
import type { Event, Session } from "./types.js";
import { ulid } from "./ulid.js";

export interface EventContext {
  harness: { name: string; version?: string };
  session: Session;
  now?: number;
}

export function makeEvent(a: AdapterEvent, ctx: EventContext): Event {
  const now = ctx.now ?? Date.now();
  const harness: Event["harness"] = { name: ctx.harness.name, event: a.harnessEvent };
  if (ctx.harness.version) harness.version = ctx.harness.version;
  return {
    protocol: 1,
    id: ulid(now),
    type: a.type,
    time: new Date(now).toISOString(),
    tier: 3,
    harness,
    session: ctx.session,
    privacy: { rulesets: [], pii: false },
    data: a.data,
  };
}
