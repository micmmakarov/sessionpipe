#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// The detached worker. `node worker.js <job>`: adapter turns the payload into
// events; facts are merged; every event is appended to the outbox with its seq;
// on a turn end the transcript is read from the stored offset for tier-2 sinks;
// then every sink is flushed from its cursor. Exits within 15 s; a sink that
// cannot be reached is left for the next worker, which drains the backlog first.
import { readFileSync, unlinkSync } from "node:fs";
import { stateDir } from "@sessionpipe/core";
import { runJob, sweepJobs } from "./run.js";

const jobFile = process.argv[2];
if (!jobFile) process.exit(0);
let job: Parameters<typeof runJob>[0] | null = null;
try {
  job = JSON.parse(readFileSync(jobFile, "utf8"));
} catch {}
try {
  unlinkSync(jobFile);
} catch {}
if (!job) process.exit(0);
const deadline = setTimeout(() => process.exit(0), 15_000);
deadline.unref();
runJob(job)
  .catch(() => {})
  .then(() => sweepJobs(stateDir()))
  .catch(() => {})
  .finally(() => process.exit(0));
