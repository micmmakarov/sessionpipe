// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  firstTableAt,
  insertTopLevel,
  previousNotify,
  readNotify,
  withNotify,
  withoutNotify,
  withPrevious,
} from "../src/adapters/codex-config.js";

const OURS = 'notify = ["/n", "/sessionpipe/dist/hook.js", "codex", "notify"]';

describe("codex config.toml", () => {
  it("finds the first table outside strings and arrays", () => {
    expect(firstTableAt("a = 1\n[t]\n")).toBe(6);
    expect(firstTableAt('a = """\n[not a table]\n"""\nb = [\n[1],\n]\n[real]\n')).toBe(
      'a = """\n[not a table]\n"""\nb = [\n[1],\n]\n'.length,
    );
    expect(firstTableAt("a = 1\n")).toBe(-1);
  });
  it("reads a top-level notify, ours or another tool's", () => {
    expect(readNotify(`${OURS}\n`)?.other).toBe(false);
    expect(readNotify('notify = ["say", "hi"]\n')?.other).toBe(true);
    expect(readNotify("")).toBeNull();
  });
  it("flags our line inside a table as misplaced and moves it", () => {
    const text = `[projects."/x"]\ntrust_level = "trusted"\n${OURS}\n`;
    expect(readNotify(text)?.misplaced).toBe(true);
    const fixed = withNotify(text, OURS);
    expect(fixed.startsWith(OURS)).toBe(true);
    expect(fixed).not.toContain(`trusted"\n${OURS}`);
    expect(readNotify(fixed)?.misplaced).toBe(false);
  });
  it("inserts before the first table and removes cleanly", () => {
    const t = insertTopLevel('model = "x"\n\n[a]\nb = 1\n', OURS);
    expect(t).toBe(`model = "x"\n${OURS}\n\n[a]\nb = 1\n`);
    expect(withoutNotify(t)).toBe('model = "x"\n\n[a]\nb = 1\n');
  });
  it("chains through --previous-notify", () => {
    const argv = withPrevious(["/client", "turn-ended"], ["/n", "hook.js"]);
    expect(previousNotify(argv)).toEqual(["/n", "hook.js"]);
    expect(withPrevious(argv, null)).toEqual(["/client", "turn-ended"]);
  });
});
