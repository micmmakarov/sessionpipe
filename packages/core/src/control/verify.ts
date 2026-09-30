// SPDX-License-Identifier: Apache-2.0
/**
 * The one verifier for signed control commands (spec/CONTROL.md §3). A receiver runs
 * it before it queues a command (so a refusal is visible to the person) and the
 * machine runs it before anything reaches a session (so the receiver is never
 * trusted). WebCrypto only: the same code runs in a Worker, Node ≥ 20 and a browser.
 *
 * Every signature covers the EXACT bytes as transmitted (`cmd`, `grant.str`): the
 * strings are parsed to read their fields and never re-serialized to verify.
 *
 * Pure: no files, no network, no clock (`now` is passed in). Nonce memory, the folder
 * allowlist and "is that attention open" are state, so they are the caller's — the
 * spec lists them as checks 6–8, after this function's 1–5.
 */
// Type-only: erased at build, so a Worker or a browser never loads node:crypto.
import type { webcrypto } from "node:crypto";

type CryptoKey = webcrypto.CryptoKey;

/** COSE algorithm ids a trusted key may use. */
export const ES256 = -7;
export const RS256 = -257;

export const LIMITS = {
  /** A command is a few hundred bytes; never parse more than this. */
  cmdBytes: 16_384,
  grantBytes: 2_000,
  /** The person's words (`text`), in UTF-16 code units as JavaScript counts them. */
  text: 12_000,
  note: 2_000,
  /** Clock slack between the signer, the receiver and the machine. */
  skewMs: 5 * 60_000,
  /** The longest unlock a passkey may vouch for. */
  grantMs: 24 * 3_600_000,
  /** The machine judges a command by when it was SIGNED: one sent while the lid was
   *  shut still runs when it wakes. The nonce memory outlives this (25 h). */
  runAgeMs: 24 * 3_600_000,
  /** A receiver refuses to queue a command signed longer ago than this. */
  sendAgeMs: 10 * 60_000,
  nonceMemoryMs: 25 * 3_600_000,
} as const;

export type ControlKindV = "prompt" | "permission.answer" | "cancel" | "start";

/** The command's fields, as read from the signed string. */
export interface ControlCommand {
  v: 1;
  t: "sessionpipe.control";
  machine: string;
  kind: ControlKindV;
  /** `<harness>:<session id>`. For `start`, a fresh id the machine will create. */
  session: string;
  /** prompt / start: the person's words. */
  text?: string;
  /** permission.answer: the attention_id being answered. */
  for?: string;
  decision?: "allow" | "deny";
  note?: string;
  /** start only: the absolute folder the new session starts in. */
  cwd?: string;
  nonce: string;
  /** Signing time, epoch ms, the signer's clock. */
  iat: number;
}

/** The day unlock: a passkey vouching for a key the signer holds. */
export interface Grant {
  v: 1;
  t: "sessionpipe.grant";
  /** SPKI DER, base64url, of the ECDSA P-256 day key. */
  pub: string;
  iat: number;
  exp: number;
  /** The WebAuthn relying party id the passkey belongs to. */
  rp: string;
}

/** A WebAuthn assertion: credential id, authenticatorData, clientDataJSON, signature (all base64url). */
export interface Assertion {
  cred: string;
  ad: string;
  cd: string;
  sig: string;
}

/** What travels: the exact command string plus either a grant and the day key's
 *  signature, or a fresh passkey assertion over sha256(cmd). */
export interface SignedCommand {
  cmd: string;
  csig?: string | null;
  grant?: (Assertion & { str: string }) | null;
  confirm?: Assertion | null;
}

/** A passkey enrolled at the machine's own terminal. */
export interface TrustedKey {
  /** The credential id, base64url. */
  id: string;
  alg: number;
  /** SPKI DER, base64url. */
  spki: string;
  /** The relying party this passkey belongs to. */
  rp: string;
}

export type RefusalCode =
  | "malformed" // the command or its signatures can't be read, or a field breaks a rule
  | "machine" // for another machine
  | "future" // signed later than now + skew
  | "stale" // signed too long ago for this checker
  | "unsigned" // neither a grant + csig nor a confirm
  | "untrusted" // signed with a passkey this checker doesn't hold
  | "assertion" // a passkey assertion that doesn't verify (wrong challenge, site, flags, signature)
  | "grant" // the unlock is malformed, too long, for another site, or (receiver) over
  | "window" // the command was signed outside its unlock
  | "csig"; // the day key's signature over the command doesn't verify

export type Verdict =
  | { ok: true; cmd: ControlCommand; via: "grant" | "confirm"; key: string; grantExp: number | null }
  | { ok: false; code: RefusalCode; why: string };

export interface VerifyOptions {
  /** This machine's id; the command must name it. */
  machine: string;
  /** Keys this checker trusts: on the machine, the ones enrolled at its terminal. */
  keys: TrustedKey[];
  now: number;
  /** How old a command may be: LIMITS.runAgeMs on the machine (default), LIMITS.sendAgeMs at a receiver. */
  maxAgeMs?: number;
  /** A receiver also refuses an unlock that is already over (the machine does not:
   *  what matters there is whether it was live when the command was signed). */
  liveGrant?: boolean;
}

// --- encodings ----------------------------------------------------------------

const B64URL = /^[A-Za-z0-9_-]*$/;

export function b64url(bytes: Uint8Array | ArrayBuffer): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i] as number);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array | null {
  if (typeof s !== "string" || !B64URL.test(s) || s.length % 4 === 1) return null;
  try {
    const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    const out = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const utf8 = (s: string) => new TextEncoder().encode(s);

export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? utf8(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= (a[i] as number) ^ (b[i] as number);
  return d === 0;
}

const no = (code: RefusalCode, why: string): Verdict => ({ ok: false, code, why });
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const isStr = (s: unknown): s is string => typeof s === "string";

// --- fields -------------------------------------------------------------------

export const NONCE_RE = /^[A-Za-z0-9_-]{22,64}$/;
export const MACHINE_RE = /^m_[A-Za-z0-9_-]{16,40}$/;
const HARNESS_RE = /^[a-z][a-z0-9-]{0,31}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ATTENTION_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/** Harnesses whose session ids have a known shape (spec/ADAPTERS.md). Any other
 *  harness gets the generic rule. */
const SESSION_SHAPE: Record<string, RegExp> = {
  "claude-code": UUID_RE,
  codex: UUID_RE,
};

/** `<harness>:<id>` → its parts, or null when either breaks its rule. */
export function parseSessionRef(s: unknown): { harness: string; id: string } | null {
  if (!isStr(s)) return null;
  const i = s.indexOf(":");
  if (i < 1) return null;
  const harness = s.slice(0, i);
  const id = s.slice(i + 1);
  if (!HARNESS_RE.test(harness)) return null;
  if (!(SESSION_SHAPE[harness] ?? SESSION_ID_RE).test(id)) return null;
  return { harness, id };
}

/** An absolute folder, POSIX or Windows, with no control characters. */
export function isAbsFolder(v: unknown): v is string {
  return (
    isStr(v) &&
    v.length <= 400 &&
    ![...v].some((ch) => ch.charCodeAt(0) < 0x20) &&
    (/^\//.test(v) || /^[A-Za-z]:[\\/]/.test(v))
  );
}

/** Read the command's fields from the exact string. Kind rules are §3.1 of CONTROL.md. */
export function parseCommand(str: unknown): { ok: true; cmd: ControlCommand } | { ok: false; why: string } {
  const bad = (why: string) => ({ ok: false as const, why });
  if (!isStr(str) || !str || utf8(str).length > LIMITS.cmdBytes)
    return bad("the command is missing or longer than 16 KiB");
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(str);
  } catch {
    return bad("the command is not JSON");
  }
  if (!c || typeof c !== "object" || Array.isArray(c)) return bad("the command is not an object");
  if (c.v !== 1 || c.t !== "sessionpipe.control") return bad("not a sessionpipe control command (v 1)");
  if (!isStr(c.machine) || !MACHINE_RE.test(c.machine)) return bad("which machine?");
  if (!isStr(c.nonce) || !NONCE_RE.test(c.nonce)) return bad("the nonce must be 22–64 base64url characters");
  if (!isNum(c.iat)) return bad("the command has no signing time");
  const ref = parseSessionRef(c.session);
  if (!ref) return bad("the session must be <harness>:<id> in that harness's id shape");
  if (c.note !== undefined && (!isStr(c.note) || c.note.length > LIMITS.note))
    return bad("the note is over 2,000 characters");
  const hasText = isStr(c.text) && c.text.trim().length > 0;
  if (c.text !== undefined && (!isStr(c.text) || c.text.length > LIMITS.text))
    return bad("the text is over 12,000 characters");
  switch (c.kind) {
    case "prompt":
      if (!hasText) return bad("a prompt needs text");
      if (c.cwd !== undefined) return bad("the machine finds a session's folder itself");
      break;
    case "start":
      if (!hasText) return bad("a new session needs its first message");
      if (!isAbsFolder(c.cwd)) return bad("a new session needs an absolute folder to start in");
      break;
    case "permission.answer":
      if (!isStr(c.for) || !ATTENTION_RE.test(c.for)) return bad("a permission answer names the attention it answers");
      if (c.decision !== "allow" && c.decision !== "deny") return bad("a permission answer is allow or deny");
      if (c.text !== undefined || c.cwd !== undefined) return bad("a permission answer carries no text or folder");
      break;
    case "cancel":
      if (c.text !== undefined || c.cwd !== undefined || c.for !== undefined)
        return bad("a cancel carries only its session");
      break;
    default:
      return bad("unknown kind");
  }
  return { ok: true, cmd: c as unknown as ControlCommand };
}

/** Read an unlock's fields from the exact string (no clock checks here). */
export function parseGrant(str: unknown): { ok: true; grant: Grant } | { ok: false; why: string } {
  const bad = (why: string) => ({ ok: false as const, why });
  if (!isStr(str) || !str || str.length > LIMITS.grantBytes) return bad("the unlock is missing or too long");
  let g: Record<string, unknown>;
  try {
    g = JSON.parse(str);
  } catch {
    return bad("the unlock is not JSON");
  }
  if (!g || typeof g !== "object" || Array.isArray(g)) return bad("the unlock is not an object");
  if (g.v !== 1 || g.t !== "sessionpipe.grant") return bad("not a sessionpipe unlock (v 1)");
  if (!isStr(g.pub) || !g.pub || !isNum(g.iat) || !isNum(g.exp) || !isStr(g.rp) || !g.rp)
    return bad("the unlock is missing parts");
  if (g.exp <= g.iat) return bad("the unlock ends before it begins");
  if (g.exp - g.iat > LIMITS.grantMs + LIMITS.skewMs) return bad("the unlock lasts longer than 24 hours");
  return { ok: true, grant: g as unknown as Grant };
}

// --- WebAuthn -----------------------------------------------------------------

/** WebAuthn's ES256 signature is ASN.1 DER; WebCrypto verifies raw r||s. */
export function derToRaw(der: Uint8Array): Uint8Array | null {
  if (der.length < 8 || der[0] !== 0x30) return null;
  let i = 2;
  if ((der[1] as number) & 0x80) i = 2 + ((der[1] as number) & 0x7f);
  const part = (): Uint8Array | null => {
    if (der[i] !== 0x02) return null;
    const len = der[i + 1] as number;
    if (i + 2 + len > der.length) return null;
    let v = der.slice(i + 2, i + 2 + len);
    i += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) return null;
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = part();
  const s = part();
  return r && s ? concat(r, s) : null;
}

async function importKey(k: TrustedKey): Promise<CryptoKey | null> {
  const spki = fromB64url(k.spki);
  if (!spki) return null;
  try {
    const der = spki as Uint8Array<ArrayBuffer>;
    if (k.alg === ES256)
      return await crypto.subtle.importKey("spki", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    if (k.alg === RS256) {
      const key = await crypto.subtle.importKey("spki", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
        "verify",
      ]);
      const bits = (key.algorithm as webcrypto.RsaHashedKeyAlgorithm).modulusLength;
      return bits >= 2048 ? key : null;
    }
  } catch {}
  return null;
}

/** Can a checker ever verify with this key? Asked when a key is enrolled. */
export async function keyUsable(k: TrustedKey): Promise<boolean> {
  return !!(await importKey(k));
}

/** Where an assertion may have been made: https on the rp id or a subdomain; plain
 *  http only when the rp is localhost. The whole value must be a bare origin. */
export function originAllowed(origin: unknown, rp: string): boolean {
  if (!isStr(origin) || !rp) return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.origin !== origin) return false;
  if (u.hostname !== rp && !u.hostname.endsWith(`.${rp}`)) return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && rp === "localhost";
}

/** One passkey assertion over `challenge`, made with `key` (webauthn.get, the person
 *  present AND verified). */
export async function verifyAssertion(
  challenge: Uint8Array,
  a: Assertion | null | undefined,
  key: TrustedKey,
): Promise<{ ok: true } | { ok: false; why: string }> {
  const bad = (why: string) => ({ ok: false as const, why });
  if (!a || typeof a !== "object") return bad("no passkey signature");
  if (a.cred !== key.id) return bad("signed with another passkey");
  const cdBytes = fromB64url(a.cd);
  const ad = fromB64url(a.ad);
  const sig = fromB64url(a.sig);
  if (!cdBytes || !ad || !sig || !sig.length) return bad("the passkey's answer can't be read");
  let cd: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    cd = JSON.parse(new TextDecoder().decode(cdBytes));
  } catch {
    return bad("the passkey's answer can't be read");
  }
  if (!cd || typeof cd !== "object") return bad("the passkey's answer can't be read");
  if (cd.type !== "webauthn.get") return bad("the passkey answered a different question");
  if (cd.challenge !== b64url(challenge)) return bad("the passkey signed something else");
  if (!originAllowed(cd.origin, key.rp))
    return bad(`the passkey was used on ${isStr(cd.origin) ? cd.origin.slice(0, 80) : "another site"}, not ${key.rp}`);
  if (cd.crossOrigin === true) return bad("the passkey was used inside another site's frame");
  if (ad.length < 37) return bad("the passkey's answer is too short");
  if (!sameBytes(ad.slice(0, 32), await sha256(key.rp)))
    return bad(`the passkey belongs to another site, not ${key.rp}`);
  const flags = ad[32] as number;
  if (!(flags & 0x01)) return bad("nobody was at the device when the passkey signed");
  if (!(flags & 0x04)) return bad("the passkey signed without a fingerprint, face or PIN");
  const pub = await importKey(key);
  if (!pub) return bad("that passkey's key can't be used");
  const signed = concat(ad, await sha256(cdBytes)) as Uint8Array<ArrayBuffer>;
  let good = false;
  try {
    if (key.alg === ES256) {
      const raw = derToRaw(sig);
      good =
        !!raw &&
        (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, raw as Uint8Array<ArrayBuffer>, signed));
    } else {
      good = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, pub, sig as Uint8Array<ArrayBuffer>, signed);
    }
  } catch {
    good = false;
  }
  return good ? { ok: true } : bad("the passkey's signature doesn't verify");
}

async function verifyCsig(cmd: string, csig: unknown, pub: string): Promise<boolean> {
  if (!isStr(csig)) return false;
  const sig = fromB64url(csig);
  const spki = fromB64url(pub);
  if (!sig || sig.length !== 64 || !spki) return false;
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      spki as Uint8Array<ArrayBuffer>,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sig as Uint8Array<ArrayBuffer>,
      utf8(cmd),
    );
  } catch {
    return false;
  }
}

// --- the whole check -----------------------------------------------------------

/**
 * Checks 1–5 of CONTROL.md §3.3: the exact bytes parse, the command names this
 * machine, it was signed within its age, and either (a) an unlock signed by a trusted
 * passkey covers its signing time and the unlock's day key signed the command, or
 * (b) a trusted passkey signed sha256(cmd) directly. When both are present the
 * confirm wins (it is the fresher proof); a failed confirm does not fall back.
 */
export async function verifyCommand(s: SignedCommand | null | undefined, o: VerifyOptions): Promise<Verdict> {
  if (!s || typeof s !== "object") return no("malformed", "no command");
  const p = parseCommand(s.cmd);
  if (!p.ok) return no("malformed", p.why);
  const cmd = p.cmd;
  if (cmd.machine !== o.machine) return no("machine", "the command is for another machine");
  if (cmd.iat > o.now + LIMITS.skewMs) return no("future", "the command is dated in the future (is a clock wrong?)");
  const maxAge = o.maxAgeMs ?? LIMITS.runAgeMs;
  if (o.now - cmd.iat > maxAge)
    return no("stale", `the command was signed more than ${Math.round(maxAge / 60_000)} minutes ago`);

  if (s.confirm) {
    const key = o.keys.find((k) => k.id === s.confirm?.cred);
    if (!key) return no("untrusted", "confirmed with a passkey this machine doesn't hold");
    const v = await verifyAssertion(await sha256(s.cmd), s.confirm, key);
    return v.ok ? { ok: true, cmd, via: "confirm", key: key.id, grantExp: null } : no("assertion", v.why);
  }
  if (!s.grant || !s.csig) return no("unsigned", "the command isn't signed — unlock with your passkey");
  const g = parseGrant(s.grant.str);
  if (!g.ok) return no("grant", g.why);
  const key = o.keys.find((k) => k.id === s.grant?.cred);
  if (!key) return no("untrusted", "the unlock was signed with a passkey this machine doesn't hold");
  if (g.grant.rp !== key.rp) return no("grant", `the unlock is for ${g.grant.rp.slice(0, 80)}, not ${key.rp}`);
  const v = await verifyAssertion(await sha256(s.grant.str), s.grant, key);
  if (!v.ok) return no("assertion", v.why);
  if (o.liveGrant && g.grant.exp <= o.now) return no("grant", "the unlock ran out — unlock with your passkey again");
  if (cmd.iat < g.grant.iat - LIMITS.skewMs || cmd.iat > g.grant.exp)
    return no("window", "the command was signed outside its unlock's day");
  if (!(await verifyCsig(s.cmd, s.csig, g.grant.pub)))
    return no("csig", "the command's signature doesn't verify — it was changed after it was signed");
  return { ok: true, cmd, via: "grant", key: key.id, grantExp: g.grant.exp };
}

/** What a passkey signs to enroll on a machine (CONTROL.md §4): bound to that machine
 *  and that pairing code, so the proof can't be replayed onto another. */
export function pairChallenge(machine: string, code: string): Promise<Uint8Array> {
  return sha256(`sessionpipe.pair:${machine}:${code}`);
}

/** Six digits the terminal and the pairing page both show for one pairing code. */
export async function pairCheck(code: string): Promise<string> {
  const h = await sha256(`sessionpipe.pair-check:${code}`);
  const n = (((h[0] as number) << 24) | ((h[1] as number) << 16) | ((h[2] as number) << 8) | (h[3] as number)) >>> 0;
  return String(n % 1_000_000).padStart(6, "0");
}

/** The enrollment proof: the new key's assertion over pairChallenge(machine, code). */
export async function verifyPairing(
  machine: string,
  code: string,
  key: TrustedKey,
  proof: Assertion,
): Promise<{ ok: true } | { ok: false; why: string }> {
  if (!(await keyUsable(key))) return { ok: false, why: "a key this machine can't use" };
  return verifyAssertion(await pairChallenge(machine, code), proof, key);
}
