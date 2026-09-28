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
server or none. Pre-release: the reference receiver and the control channel are
still being built; see the [roadmap](https://github.com/micmmakarov/sessionpipe/blob/main/ROADMAP.md).

Docs and the protocol: [sessionpipe.org](https://sessionpipe.org) · Source:
[github.com/micmmakarov/sessionpipe](https://github.com/micmmakarov/sessionpipe) · Apache-2.0.
Provided as-is; check what a sink receives with `sessionpipe tail` before you point it anywhere.
