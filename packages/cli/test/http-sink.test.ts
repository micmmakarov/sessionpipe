// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { webhookId } from "../src/http-sink.js";

describe("webhook-id (HTTP.md §2: retries reuse it)", () => {
  it("is the same for the same batch and differs for another", () => {
    const a = [{ id: "01K6ABCXYZ0123456789ABCDEF" }, { id: "01K6ABCXYZ0123456789ABCDEG" }];
    expect(webhookId(a)).toBe(webhookId([...a]));
    expect(webhookId(a)).not.toBe(webhookId(a.slice(0, 1)));
    expect(webhookId(a)).toMatch(/^msg_[A-Za-z0-9_-]{32}$/);
  });
});
