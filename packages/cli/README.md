# sessionpipe

**An open protocol, and a client, for what your coding agents are doing.** One
install hooks Claude Code, Codex, Gemini CLI and Antigravity (Cursor, Copilot CLI,
Droid, Kiro and OpenCode are next); every event is filtered to a privacy tier you
choose per destination; secrets are removed on your machine before anything leaves
it; it goes to your server, to a file, or nowhere at all.

```sh
npx sessionpipe install        # writes the hooks, backfills 30 days locally
sessionpipe tail --tier 1      # watch events, no server needed
sessionpipe sink add https://your-receiver.example --tier 1 --token <t>
sessionpipe doctor             # what is wired, hook timing, sink state
sessionpipe uninstall          # every config file byte-identical again
```

| Tier | What leaves |
|-----:|-------------|
| 0 | session state and timing, folder, repo, branch, model, title, the *kind* of attention needed |
| 1 | + tool names, durations, ok/error, file paths, the attention message |
| 2 | + your prompts and the assistant's text, redacted |
| 3 | + tool input and output |

No telemetry. Secrets never leave (`secrets@1` runs above tier 0, always). Your
server or none. Pre-release: the reference receiver is still being built; see the
[roadmap](https://github.com/micmmakarov/sessionpipe/blob/main/ROADMAP.md).

## Control: messages to your sessions (M6, Claude Code first)

A receiver that lists `control` can carry a message from your phone to a session on
this machine. It is signed on your device and **checked here**, against a key you
enroll at this terminal; the receiver can queue a message but can never forge one
([spec](https://sessionpipe.org/protocol/control/)).

```sh
sessionpipe control pair spacesheep.dev   # one link: approve with your passkey; installs the daemon (this folder by default)
sessionpipe control status          # receivers, parked waiters, sessions mid-turn, open permission prompts
sessionpipe control keys [remove <id>]
sessionpipe control off             # tell the receiver, forget its token and keys
```

Pairing through `npx` first installs that version globally and runs pairing from
that persistent copy. On Homebrew, the daemon uses a matching stable Node link
so a Node upgrade does not leave it pointing at a removed Cellar version.

Services paired with older versions are **not** repaired by `install` or `update`.
After upgrading, run `sessionpipe control pair <receiver>` again (without
`--no-service`) to rewrite the service with persistent paths. On Linux, restart an
already-running daemon afterward with `systemctl --user restart sessionpipe-control.service`;
macOS pairing reloads the LaunchAgent.

One daemon per computer holds one long-poll per receiver and delivers each message the
cheapest way the session allows: to `sessionpipe wait` parked in the session's
background (in place, ~60 ms, no network), at the session's next Stop if it is
mid-turn, through the Agent SDK for a session it started (if the SDK is installed), or
as a headless `claude -p --resume` (a `--fork-session` copy when a live process holds
it). A session stays reachable in place with zero idle turns by running, as a
background command with the longest timeout it can (Claude Code: raise
`BASH_MAX_TIMEOUT_MS`, else a background command is stopped after 2 hours at most):

```sh
sessionpipe wait            # Claude Code: the session id comes from CLAUDE_CODE_SESSION_ID
```

Permission prompts can be answered from the receiver too: while the terminal shows
its prompt, the PermissionRequest hook waits for your signed answer, and whichever
comes first wins. Nothing is ever auto-allowed. Safe mode (the default) runs headless
turns with `--permission-mode dontAsk`, so nothing that needs approval runs while
you're away.

Docs and the protocol: [sessionpipe.org](https://sessionpipe.org) · Source:
[github.com/micmmakarov/sessionpipe](https://github.com/micmmakarov/sessionpipe) · Apache-2.0.
Provided as-is; check what a sink receives with `sessionpipe tail` before you point it anywhere.
