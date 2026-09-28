// SPDX-License-Identifier: Apache-2.0
/** sessionpipe — the client. Programmatic surface: run a hook job, flush sinks. */

export { HttpSink } from "./http-sink.js";
export { buildSinks, factsState, flush, type Job, runJob } from "./run.js";
