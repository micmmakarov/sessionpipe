export declare const RULESET_PII = "pii@1";
/** Replace emails and phone numbers, and write `home` as `~`. */
export declare function reducePii(text: string, home?: string): string;
/** The machine's name under pii@1: the first 8 hex of its SHA-256. */
export declare function hashMachine(name: string): string;
/** Apply pii@1 to every string in a value; `home` becomes `~`. */
export declare function reducePiiDeep<T>(v: T, home?: string): T;
//# sourceMappingURL=pii.d.ts.map
