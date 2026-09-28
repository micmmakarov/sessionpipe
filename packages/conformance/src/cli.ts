#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// npx @sessionpipe/conformance <fixture dir>          run adapter fixtures
// npx @sessionpipe/conformance https://host [--token] run the receiver scenarios (M3)
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { runAdapterFixtures } from "./index.js";

const target = process.argv[2];
if (!target) {
  process.stdout.write("usage: sessionpipe-conformance <conformance/harness dir | https://receiver>\n");
  process.exit(2);
}
if (/^https?:\/\//.test(target)) {
  process.stdout.write("receiver scenarios land in M3\n");
  process.exit(2);
}
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = path.join(d, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".json") ? [p] : [];
  });
const r = await runAdapterFixtures(walk(target));
process.stdout.write(`${r.table}\n${r.results.length - r.failed}/${r.results.length} passed\n`);
process.exit(r.failed ? 1 : 0);
