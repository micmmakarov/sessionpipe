---
"sessionpipe": minor
"sessionpipe-core": minor
---

The control daemon (M6): `sessionpipe control pair | status | keys | off | run` and `sessionpipe wait`. One daemon per computer verifies every command against keys enrolled at its terminal and delivers it in place when it can (a parked waiter, the session's next Stop, an Agent SDK session it started), else as a headless resume or fork; Stop and PermissionRequest hooks answer only for verified messages, and only where control is paired. Claude Code's PermissionRequest hook timeout is now 130 s (re-run `sessionpipe install`). A machine caps new sessions itself (2 at once, 10 an hour, `limits` in control.json) and runs at most 3 headless Claude Code processes at once; messages are handled concurrently, one session's in order; after a receiver outage the daemon is polling again within seconds and logs `back after N s`.
