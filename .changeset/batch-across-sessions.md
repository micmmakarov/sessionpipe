---
"sessionpipe": patch
---

The sink drain packs events from many sessions into one batch of up to 50 (a first install's backfill is a handful of POSTs, not one per session); cursors move only after the batch was acknowledged.
