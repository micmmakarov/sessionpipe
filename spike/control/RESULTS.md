# M6 spike: four experiments against a real `claude`

Claude Code 2.1.286, Linux, model Haiku 4.5, 2026-09-30. Scripts in this folder;
each experiment ran in a scratch project with its own `--settings`. This decides the
delivery table in spec/CONTROL.md §5.

| # | Experiment | Verdict | Measured |
|---|------------|---------|----------|
| 1 | Local waiter wakes in place | **pass, with a floor** | in place 1.79 s and 1.93 s after the write; daemon restart = reconnect in ≤ 1 s, 0 model turns; idle floor 1 wake / ~2 h |
| 2 | PermissionRequest held open | **pass** | terminal prompt shown while the hook waits; a remote answer at 14.6 s allowed the tool; a terminal answer ended the hook (SIGTERM at 6.6 s) |
| 3 | Stop block as delivery | **pass** | the queued text was answered in the same `-p` run (2.4 s total, 2 turns); second Stop had `stop_hook_active: true`, no loop |
| 4 | SDK streaming session | **not run** | blocked in this session by the auto-mode permission classifier (an SDK agent with `permissionMode: "dontAsk"`); needs the maintainer's go-ahead |

## 1 · Waiter (`waiter.mjs`, `daemon-stub.mjs`)

An interactive session was asked to run `node waiter.mjs $CLAUDE_CODE_SESSION_ID` as a
background Bash command. It chose `run_in_background: true` and `timeout: 7200000`
itself. The waiter parked on a Unix socket; `daemon-stub.mjs send` wrote to it.

- **Delivery**: write → the session's reply in its transcript in 1,785 ms, then
  1,928 ms after a restart. The session answered in place and re-ran the waiter on its
  own, as the waiter's output asked.
- **Daemon restart**: killed the daemon for 5 s and started it again. The waiter
  reconnected within a second; the transcript gained **no** assistant messages (no
  wake). A restart must be a reconnect, never an exit.
- **The floor is not zero.** Claude Code caps a background command at 2 hours
  (`timeout` max 7,200,000 ms), and the model is re-invoked when one ends. So the
  waiter exits itself shortly before (1 h 57 m) and asks to be run again: **≈ 0.5 idle
  wakes per listening hour**, against 1.94 today (a Monitor re-armed every 30 min).
  Zero needs the `sdk` mode (4) or a harness input API.
- **Two findings for the design:**
  - A Unix socket path is limited to ~104–108 bytes; a socket under a deep temp dir
    failed with `EADDRINUSE`. The spec fixes the path
    (`$XDG_RUNTIME_DIR/sessionpipe/control.sock`, else `~/.sessionpipe/control.sock`).
  - `Bash(node:*)` did not match `SPIKE_SOCK=… node …`, so every re-arm stopped on a
    permission prompt. The waiter must be one stable command, `sessionpipe wait
    <session>`, and the installer must allowlist `Bash(sessionpipe wait:*)`. Otherwise
    a re-arm while the person is away stalls on a prompt nobody answers.
- Not covered here: 2 h idle (a soak is running), and a Mac sleep (Linux host).

## 2 · PermissionRequest held open (`perm-hold.mjs`)

A `PermissionRequest` hook with `timeout: 120` that waits (polling for an answer
file, standing in for the socket) and prints
`{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":…}}}`.

- The terminal showed its normal "Do you want to proceed?" **while the hook was
  still waiting**, so a held hook costs the person at the keyboard nothing.
- Remote answer first: `allow` written at 14.6 s → "Allowed by PermissionRequest
  hook", the tool ran.
- Terminal answer first: pressing `3` (No) interrupted the tool, and the hook got
  **SIGTERM** at once. Pressing `1` (Yes) ran the tool. So the first answer wins
  either way, and the daemon learns of a terminal answer from the signal. That is
  `attention.cleared` `how: answered`.
- Hook input keys: `session_id, transcript_path, cwd, permission_mode,
  hook_event_name, tool_name, tool_input, permission_suggestions, prompt_id`. There
  is no `tool_use_id`, which confirms the adapter's hashed `perm-…` id.

## 3 · Stop block (`stop-block.mjs`)

`claude -p "Say hello in one word."` with a Stop hook that answers
`{"decision":"block","reason":<queued text>}` when `stop_hook_active` is false.
Result: `"ANSWER: 51"` for "what is 17 times 3?", 2 turns, 2.4 s. The second Stop
arrived with `stop_hook_active: true` and the hook stayed quiet, so there was no loop.
The transcript records the text as *Stop hook feedback* (`hook_blocking_error`), not
as a user turn. That is why CONTROL.md §6.1 has the daemon frame it as "a message
from the person who owns this session".

## 4 · SDK streaming (`sdk-stream.mjs`)

Written, not run. It starts `query()` with an async-iterable prompt, answers once,
idles 60 s counting messages, then pushes a second message and times the first
streamed token. Run it with `@anthropic-ai/claude-agent-sdk` installed:
`SPIKE_IDLE_MS=60000 node sdk-stream.mjs`. Pass: 0 messages while idle, first token
≤ 3 s, and the session listed by `claude --resume`.

## What changes in the plan

- `waiter` stays, with ~0.5 idle wakes/h instead of 0. The 0 target moves to
  sessions the daemon starts itself (`sdk`), pending experiment 4.
- `turn` and the held `PermissionRequest` are confirmed as designed.
- The installer allowlists `sessionpipe wait`, and the socket path is fixed and short.
