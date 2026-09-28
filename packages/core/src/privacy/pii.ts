// SPDX-License-Identifier: Apache-2.0
// pii@1 — an opt-in second pass that reduces identifiers (spec/PRIVACY.md §2). It
// does not promise anonymity; it removes the obvious.
import { createHash } from "node:crypto";

export const RULESET_PII = "pii@1";

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
/** E.164 and common national forms: an optional +, 7–15 digits with separators,
 *  optional area-code parentheses. A version number (22.23.1) or an IP never matches:
 *  the run must not sit between dots, and needs ≥ 7 digits. */
const PHONE = /(?<![\w.])(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?)?\d{2,4}(?:[ .-]?\d{2,4}){1,3}(?!\w)/g;

function looksPhone(s: string): boolean {
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  // "port 8891, pr 12345": a bare run with no separator or + is a number, not a phone.
  if (!/[+() .-]/.test(s)) return false;
  // "22.23.1", "185.199.108.153": dots alone are a version or an address.
  if (!/[+() -]/.test(s)) return false;
  return true;
}

/** Replace emails and phone numbers, and write `home` as `~`. */
export function reducePii(text: string, home?: string): string {
  if (!text) return text;
  let out = text.replace(EMAIL, "[email]");
  out = out.replace(PHONE, (m) => (looksPhone(m) ? "[phone]" : m));
  if (home) {
    const h = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![A-Za-z0-9_])${h}(?=/|$|\\s|["'\`])`, "g"), "~");
  }
  return out;
}

/** The machine's name under pii@1: the first 8 hex of its SHA-256. */
export function hashMachine(name: string): string {
  return createHash("sha256").update(name).digest("hex").slice(0, 8);
}

/** Apply pii@1 to every string in a value; `home` becomes `~`. */
export function reducePiiDeep<T>(v: T, home?: string): T {
  if (typeof v === "string") return reducePii(v, home) as T;
  if (Array.isArray(v)) return v.map((x) => reducePiiDeep(x, home)) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = reducePiiDeep(x, home);
    return out as T;
  }
  return v;
}
