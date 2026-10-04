---
"sessionpipe": patch
"sessionpipe-core": patch
---

Antigravity: stop hooking PreToolUse. Antigravity reads a PreToolUse answer without a
`decision` as a deny, so the `{}` sessionpipe printed blocked every tool call on every
machine it was installed on, with no reason shown. Tool activity now comes from
PostToolUse (a "still working" beat, since Antigravity names no tool there).
`sessionpipe install` / `update` (and the daemon's auto-update) rewrite the old entry; a
conversation that started before the rewrite still has it loaded, and gets an `ask` with
a reason instead of a silent deny until it is restarted.
