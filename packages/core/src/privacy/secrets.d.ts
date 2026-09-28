export declare const RULESET_SECRETS = "secrets@1";
export declare const REDACTED = "[redacted]";
/** Is this identifier the name of a secret? `DB_PASSWORD`, `apiKey`, `client-secret`,
 *  `AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`; an env-style `STRIPE_KEY` too. Not
 *  `password_hash`, `tokenizer`, `sort_key`. */
export declare function isSecretName(name: string): boolean;
/** Redact every credential in `text`. Returns the same string when there is none. */
export declare function redactSecrets(text: string): string;
/** Did redaction change anything? */
export declare function hasSecret(text: string): boolean;
/** Redact every string in a JSON-able value (keys are left alone). */
export declare function redactDeep<T>(v: T): T;
//# sourceMappingURL=secrets.d.ts.map
