import type { Event, Tier } from "../types.js";
import type { DeliveryResult, Sink } from "./types.js";
export declare class FileSink implements Sink {
  readonly name: string;
  readonly file: string;
  readonly tier: Tier;
  readonly pii: boolean;
  constructor(name: string, file: string, tier: Tier, pii: boolean);
  send(events: Event[]): Promise<DeliveryResult>;
}
//# sourceMappingURL=file.d.ts.map
