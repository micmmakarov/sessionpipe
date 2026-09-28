import type { Tier } from "./types.js";
export interface SinkConfig {
  name: string;
  /** https://…, file:PATH, stdout, otlp:URL */
  url: string;
  tier: Tier;
  pii?: boolean;
  control?: boolean;
  token?: string;
  /** whsec_… for Standard Webhooks signatures. */
  secret?: string;
  /** Learned from the receiver's well-known file; re-read daily. */
  max_tier?: Tier;
  well_known_at?: string;
  paused?: string;
}
export interface Config {
  machine?: string;
  sinks: SinkConfig[];
  harnesses: Record<
    string,
    {
      enabled?: boolean;
    }
  >;
  update_check?: boolean;
  keep_days?: number;
}
export declare const DEFAULT_CONFIG: Config;
export declare function readConfig(file?: string): Config;
export declare function writeConfig(c: Config, file?: string): void;
/** The machine's name: what the person configured, else the hostname without a
 *  local suffix. Never guessed from anything else (a hand-typed name once linked 64
 *  versions to nothing). */
export declare function machineName(c: Config, hostname: string): string;
//# sourceMappingURL=config.d.ts.map
