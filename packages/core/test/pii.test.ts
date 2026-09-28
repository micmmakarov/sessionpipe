// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hashMachine, reducePii } from "../src/privacy/pii.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fx = JSON.parse(readFileSync(path.join(root, "conformance/redaction/pii.json"), "utf8"));

describe("pii@1 vectors", () => {
  for (const c of fx.cases as { name: string; in: string; out: string; home?: string }[]) {
    it(c.name, () => expect(reducePii(c.in, c.home)).toBe(c.out));
  }
  for (const s of fx.session as { name: string; in: { machine: string }; out: { machine: string } }[]) {
    it(s.name, () => expect(hashMachine(s.in.machine)).toBe(s.out.machine));
  }
});
