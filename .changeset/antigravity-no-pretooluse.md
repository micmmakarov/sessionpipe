---
"sessionpipe": patch
"sessionpipe-core": patch
---

Antigravity: stop hooking PreToolUse. Antigravity reads a PreToolUse answer without a
`decision` as a deny, so the `{}` sessionpipe printed blocked every tool call on every
machine it was installed on, with no reason shown. Tool activity now comes from
PostToolUse (a "still working" beat, since Antigravity names no tool there).
`sessionpipe install` / `update` (and the daemon's auto-update) rewrite the old entry.
Restart Antigravity to reload already-open conversations;
stale PreToolUse invocations receive no permission decision. Doctor warns when recent
PreToolUse records have no PostToolUse completions and identifies an unsafe registration
as stale, with install/restart instructions.
