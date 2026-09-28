export declare function gitFacts(cwd: string | undefined): {
  repo?: string;
  branch?: string;
};
/** `https://user:token@host/x` → `https://host/x`; `git@github.com:a/b.git` → `github.com/a/b`. */
export declare function stripCredentials(url: string): string;
//# sourceMappingURL=git.d.ts.map
