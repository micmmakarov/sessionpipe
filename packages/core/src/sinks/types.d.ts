import type { Event, Tier } from "../types.js";
export interface DeliveryResult {
  ok: boolean;
  /** Events the receiver counted (accepted + duplicates + rejected). */
  acknowledged: number;
  accepted?: number;
  duplicates?: number;
  rejected?: {
    id: string;
    reason: string;
  }[];
  /** A lowered cap learned from the receiver. */
  max_tier?: Tier;
  status?: number;
  error?: string;
  /** What the sender should do next: retry later, split the batch, pause the sink. */
  action?: "retry" | "split" | "pause" | "lower-tier" | "drop";
  retryAfterMs?: number;
}
export interface Sink {
  readonly name: string;
  readonly tier: Tier;
  readonly pii: boolean;
  /** Deliver one batch of ALREADY FILTERED events. */
  send(events: Event[]): Promise<DeliveryResult>;
}
//# sourceMappingURL=types.d.ts.map
