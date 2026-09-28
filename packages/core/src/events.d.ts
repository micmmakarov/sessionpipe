import type { AdapterEvent } from "./adapters/types.js";
import type { Event, Session } from "./types.js";
export interface EventContext {
  harness: {
    name: string;
    version?: string;
  };
  session: Session;
  now?: number;
}
export declare function makeEvent(a: AdapterEvent, ctx: EventContext): Event;
//# sourceMappingURL=events.d.ts.map
