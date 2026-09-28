import type { Event, Tier } from "../types.js";
import type { DeliveryResult, Sink } from "./types.js";
export declare class StdoutSink implements Sink {
  readonly name: string;
  readonly tier: Tier;
  readonly pii: boolean;
  private readonly write;
  constructor(name: string, tier: Tier, pii: boolean, write?: (line: string) => void);
  send(events: Event[]): Promise<DeliveryResult>;
}
//# sourceMappingURL=stdout.d.ts.map
