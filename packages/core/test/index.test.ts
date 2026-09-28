// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../src/index.js";

describe("core", () => {
  it("speaks protocol 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
