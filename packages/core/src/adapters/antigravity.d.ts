import type { Adapter, FactsState, SessionFacts } from "./types.js";
export declare const AG_EVENTS: readonly ["PreInvocation", "PostInvocation", "PreToolUse", "PostToolUse", "Stop"];
export declare const antigravity: Adapter;
/** A folder as Antigravity writes it (a file:// URI or a path) → an absolute path, or null. */
export declare function agPath(p: unknown): string | null;
export declare const agWorkspaces: (paths: unknown) => string[];
/** The project whose folder is the workspace or contains it; the deepest wins. */
export declare function agMatchProject(
  projects: {
    id: string;
    folders: string[];
  }[],
  workspaces: string[],
): string | null;
/** Antigravity's web remote: https://antigravity.google.com/r/<installation uuid>-v2, with
 *  ?p=c/<conversation>?section=<project> when the project is known. */
export declare function antigravityRemoteUrl(
  transcript: string,
  opts: {
    conversation?: string;
    workspaces?: string[];
    env: NodeJS.ProcessEnv;
    projectsDir?: string;
  },
): string | null;
export declare function antigravityFacts(
  file: string,
  opts: {
    conversation: string;
    workspaces: string[];
    state: FactsState;
    env: NodeJS.ProcessEnv;
  },
): SessionFacts;
//# sourceMappingURL=antigravity.d.ts.map
