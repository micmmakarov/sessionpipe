export declare const HOME: string;
export declare function configFile(env?: NodeJS.ProcessEnv): string;
export declare function stateDir(env?: NodeJS.ProcessEnv): string;
/** `~` for the home directory, as the session block writes paths. */
export declare function tilde(p: string, home?: string): string;
/** A file-name-safe id. */
export declare const safeId: (s: string) => string;
//# sourceMappingURL=paths.d.ts.map
