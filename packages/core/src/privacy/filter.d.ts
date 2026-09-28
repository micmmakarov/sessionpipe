import type { Event, Tier } from "../types.js";
/** The lowest tier that carries each known type (kept in step with schema/v1.ts). */
export declare const TYPE_TIER: Record<string, Tier>;
export interface FilterOptions {
  /** The person's home directory, for pii@1's `~` rewrite. */
  home?: string;
}
/** The event as a sink at `tier` may see it, or null when the type is above the tier. */
export declare function filterEvent(event: Event, tier: Tier, pii: boolean, opts?: FilterOptions): Event | null;
//# sourceMappingURL=filter.d.ts.map
