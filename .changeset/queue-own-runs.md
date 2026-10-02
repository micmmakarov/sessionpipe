---
"sessionpipe": patch
---

A message for a session the daemon's own run is still working on (a start, a resume) waits for that run and resumes the session, instead of forking a copy that would work the same task in parallel.
