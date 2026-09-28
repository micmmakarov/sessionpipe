// SPDX-License-Identifier: Apache-2.0
// The ruleset against its own vectors (conformance/redaction/secrets.json): every
// case, the templated credential recipes, and the adversarial recipes with a time
// budget. Any other copy of the rules (a server-side re-check) runs this file's
// fixture, never a copy of these expectations.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hasSecret, REDACTED, redactDeep, redactSecrets } from "../src/privacy/secrets.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fx = JSON.parse(readFileSync(path.join(root, "conformance/redaction/secrets.json"), "utf8"));
const rnd = (n: number, abc: string = fx.rnd_default_abc) =>
  Array.from({ length: n }, (_, i) => abc[(i * 7 + 3) % abc.length]).join("");
const build = (parts: { prefix: string; len: number; abc?: string }[]) =>
  parts.map((p) => p.prefix + rnd(p.len, p.abc)).join("");
const materialise = (c: { in?: string; template?: string; t?: { prefix: string; len: number; abc?: string }[] }) =>
  c.in ?? (c.template as string).replace(/\{t\}/g, build(c.t ?? []));

describe("secrets@1 vectors", () => {
  expect(fx.redacted).toBe(REDACTED);
  for (const c of fx.cases as { name: string; in?: string; template?: string; t?: never[]; out: string }[]) {
    it(`${c.name}: ${(c.in ?? c.template ?? "").slice(0, 50)}`, () => {
      const input = materialise(c);
      expect(redactSecrets(input)).toBe(c.out);
      if (c.template)
        for (const part of c.t as unknown as { prefix: string; len: number; abc?: string }[])
          expect(redactSecrets(input)).not.toContain(rnd(part.len, part.abc).slice(-10));
      if (c.name === "untouched") expect(hasSecret(input)).toBe(false);
    });
  }
});

describe("secrets@1 adversarial (linear time)", () => {
  const grow = (r: {
    prefix?: string;
    repeat: string;
    times: number;
    then?: string;
    then_repeat?: string;
    then_times?: number;
    suffix?: string;
  }) =>
    (r.prefix ?? "") +
    r.repeat.repeat(r.times) +
    (r.then ?? "") +
    (r.then_repeat ? r.then_repeat.repeat(r.then_times ?? 0) : "") +
    (r.suffix ?? "");
  for (const a of fx.adversarial as { name: string; recipe: never; max_ms: number }[]) {
    it(`stays fast on ${a.name}`, () => {
      const s = grow(a.recipe);
      const t0 = Date.now();
      redactSecrets(s);
      expect(Date.now() - t0).toBeLessThan(a.max_ms);
    });
  }
});

describe("redactDeep", () => {
  it("redacts every string in a value, leaving keys and numbers", () => {
    const out = redactDeep({
      session: { id: "019a-77", seq: 3 },
      data: { user: "use DB_PASSWORD=hunter2", assistant: "done" },
    });
    expect(out.data.user).toBe(`use DB_PASSWORD=${REDACTED}`);
    expect(out.session.seq).toBe(3);
    expect(out.session.id).toBe("019a-77");
  });
});
