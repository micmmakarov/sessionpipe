---
"sessionpipe-core": patch
"sessionpipe": patch
---

Skip the parent's replayed history in forked Codex rollouts when reading session
facts and transcripts. Wait for an event naming the fork's own thread, preserve
its original transcript timestamps and cursors, and leave its title unset until
it contains a real user ask of its own.
