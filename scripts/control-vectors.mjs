// SPDX-License-Identifier: Apache-2.0
// Writes conformance/control-vectors/*.json: signed control commands, valid and
// broken, each with the verdict a conforming verifier must reach (spec/CONTROL.md
// §3.3). A simulated authenticator (node:crypto) plays the passkey, so the vectors
// are real WebAuthn assertions, not stubs.
//
// ECDSA signatures are randomized, so a rerun rewrites every file: run it only when
// a case is added or changed (`node scripts/control-vectors.mjs`), never in CI. CI
// runs the committed vectors through core's verifier (packages/core/test/control.test.ts).
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "conformance/control-vectors");

const b64u = (b) => Buffer.from(b).toString("base64url");
const sha = (b) => createHash("sha256").update(b).digest();
const NOW = 1_790_800_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const MACHINE = "m_Qx7uR2bT9kLmN4pV8sWz";
const OTHER_MACHINE = "m_Zz9yX8wV7uT6sR5qP4oN";
const RP = "receiver.example";
const ORIGIN = `https://${RP}`;
const SESSION = "claude-code:bedc5a64-3f1e-4c7a-9b2d-5e8f0a1c6d42";
const nonce = () => b64u(randomBytes(18)); // 24 chars

// --- a simulated authenticator ---------------------------------------------------

function passkey(alg = -7) {
  const { privateKey, publicKey } =
    alg === -7
      ? generateKeyPairSync("ec", { namedCurve: "prime256v1" })
      : generateKeyPairSync("rsa", { modulusLength: 2048 });
  const id = b64u(randomBytes(20));
  return {
    alg,
    id,
    privateKey,
    trusted: (rp = RP) => ({ id, alg, spki: b64u(publicKey.export({ type: "spki", format: "der" })), rp }),
  };
}

/** A navigator.credentials.get() answer over `challenge`. */
function assert(pk, challenge, o = {}) {
  const rp = o.rp ?? RP;
  const cd = Buffer.from(
    JSON.stringify({
      type: o.type ?? "webauthn.get",
      challenge: b64u(challenge),
      origin: o.origin ?? ORIGIN,
      crossOrigin: o.crossOrigin ?? false,
    }),
  );
  const flags = o.flags ?? 0x05; // UP | UV
  const ad = Buffer.concat([sha(Buffer.from(rp)), Buffer.from([flags]), Buffer.from([0, 0, 0, 7])]);
  const s = createSign("sha256");
  s.update(Buffer.concat([ad, sha(cd)]));
  const sig = pk.alg === -7 ? s.sign({ key: pk.privateKey, dsaEncoding: "der" }) : s.sign(pk.privateKey);
  return { cred: pk.id, ad: b64u(ad), cd: b64u(cd), sig: b64u(sig) };
}

/** A day key and the passkey's unlock for it. */
function unlock(pk, o = {}) {
  const day = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const iat = o.iat ?? NOW - 2 * HOUR;
  const str = JSON.stringify({
    v: 1,
    t: o.t ?? "sessionpipe.grant",
    pub: b64u(day.publicKey.export({ type: "spki", format: "der" })),
    iat,
    exp: o.exp ?? iat + 24 * HOUR,
    rp: o.rp ?? RP,
  });
  return { day, bundle: { str, ...assert(pk, sha(Buffer.from(str)), o.assertion) } };
}

const signWith = (key, str) => b64u(createSign("sha256").update(str).sign({ key, dsaEncoding: "ieee-p1363" }));

function command(fields = {}) {
  return JSON.stringify({
    v: 1,
    t: "sessionpipe.control",
    machine: MACHINE,
    kind: "prompt",
    session: SESSION,
    text: "Add the Oct 8 row",
    nonce: nonce(),
    iat: NOW - 5 * MIN,
    ...fields,
  });
}

// --- the cases -------------------------------------------------------------------

const alice = passkey();
const mallory = passkey();
const rsa = passkey(-257);
const keys = [alice.trusted(), rsa.trusted()];
const cases = [];
const add = (name, spec, input, expect, extra = {}) => cases.push({ name, spec, input, expect, ...extra });

function viaGrant(fields, o = {}) {
  const u = unlock(o.pk ?? alice, o.unlock);
  const cmd = o.raw ?? command(fields);
  return { cmd: o.sent ?? cmd, csig: signWith((o.dayKey ?? u.day).privateKey, cmd), grant: u.bundle };
}
function viaConfirm(fields, o = {}) {
  const cmd = o.raw ?? command(fields);
  return { cmd: o.sent ?? cmd, confirm: assert(o.pk ?? alice, sha(Buffer.from(o.signed ?? cmd)), o.assertion) };
}

// valid
add("prompt-grant", "§3.3 a day key signs, a passkey vouches", viaGrant({}), { ok: true, via: "grant" });
add("prompt-confirm", "§3.3 one passkey assertion over sha256(cmd)", viaConfirm({}), { ok: true, via: "confirm" });
add(
  "permission-allow",
  "§3.1 permission.answer",
  viaGrant({ kind: "permission.answer", for: "toolu_01AbCdEf", decision: "allow", text: undefined }),
  { ok: true, via: "grant" },
);
add("cancel", "§3.1 cancel carries only its session", viaGrant({ kind: "cancel", text: undefined }), {
  ok: true,
  via: "grant",
});
add(
  "start",
  "§3.1 start names a fresh id and a folder",
  viaConfirm({ kind: "start", session: "claude-code:0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e", cwd: "/Users/me/code/app" }),
  { ok: true, via: "confirm" },
);
add(
  "slept-23h",
  "§3.3 check 5: judged by when it was signed (lid shut)",
  viaGrant({ iat: NOW - 23 * HOUR }, { unlock: { iat: NOW - 23.5 * HOUR } }),
  { ok: true, via: "grant" },
);
add(
  "grant-over-command-inside",
  "§3.3 check 3: the unlock has ended now, but was live at signing",
  viaGrant({ iat: NOW - 3 * HOUR }, { unlock: { iat: NOW - 26 * HOUR, exp: NOW - 2 * HOUR } }),
  { ok: true, via: "grant" },
);
add("rs256-confirm", "§4 RS256 passkeys", viaConfirm({}, { pk: rsa }), { ok: true, via: "confirm" });
add(
  "codex-session",
  "§3.1 session ids follow the adapter",
  viaGrant({ session: "codex:019a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b" }),
  { ok: true, via: "grant" },
);
add(
  "opencode-session",
  "§3.1 other harnesses: [A-Za-z0-9._-]{1,128}",
  viaGrant({ session: "opencode:ses_7Hk2mP9qRt" }),
  { ok: true, via: "grant" },
);

// broken: the bytes
const signed = command({});
add(
  "reserialized",
  "§3.3 check 1: signatures cover the exact bytes",
  viaGrant({}, { raw: signed, sent: JSON.stringify(JSON.parse(signed), null, 1) }),
  { ok: false, code: "csig" },
);
add(
  "edited-text",
  "§3.3 check 4: a changed field breaks csig",
  viaGrant({}, { raw: signed, sent: signed.replace("Oct 8", "Oct 9") }),
  { ok: false, code: "csig" },
);
add("legacy-type", "§3.1 t is sessionpipe.control", viaGrant({ t: "ss-machine-cmd" }), {
  ok: false,
  code: "malformed",
});
add("unknown-kind", "§3.1 kinds", viaGrant({ kind: "shell" }), { ok: false, code: "malformed" });
add("nonce-short", "§3.1 nonce 22–64 base64url", viaGrant({ nonce: "abc123" }), { ok: false, code: "malformed" });
add("nonce-long", "§3.1 nonce 22–64 base64url", viaGrant({ nonce: "a".repeat(65) }), { ok: false, code: "malformed" });
add("text-over-cap", "§3.1 text ≤ 12,000 characters", viaGrant({ text: "x".repeat(12_001) }), {
  ok: false,
  code: "malformed",
});
add("session-shape", "§3.1 claude-code ids are UUIDs", viaGrant({ session: "claude-code:not-a-uuid" }), {
  ok: false,
  code: "malformed",
});
add(
  "session-no-harness",
  "§3.1 session is <harness>:<id>",
  viaGrant({ session: "bedc5a64-3f1e-4c7a-9b2d-5e8f0a1c6d42" }),
  { ok: false, code: "malformed" },
);
add("prompt-with-cwd", "§3.1 the machine finds a session's folder itself", viaGrant({ cwd: "/etc" }), {
  ok: false,
  code: "malformed",
});
add("start-relative-cwd", "§3.1 start needs an absolute folder", viaGrant({ kind: "start", cwd: "code/app" }), {
  ok: false,
  code: "malformed",
});
add(
  "answer-no-for",
  "§3.1 permission.answer names its attention",
  viaGrant({ kind: "permission.answer", decision: "allow", text: undefined }),
  { ok: false, code: "malformed" },
);
add(
  "answer-bad-decision",
  "§3.1 allow or deny",
  viaGrant({ kind: "permission.answer", for: "toolu_01", decision: "always", text: undefined }),
  { ok: false, code: "malformed" },
);
add("oversize", "§3.1 a command is at most 16 KiB", viaGrant({ note: "n".repeat(1_900), text: "é".repeat(8_000) }), {
  ok: false,
  code: "malformed",
});

// broken: where and when
add("other-machine", "§3.3 check 2", viaGrant({ machine: OTHER_MACHINE }), { ok: false, code: "machine" });
add("future", "§3.3 check 5: at most 5 minutes of skew", viaGrant({ iat: NOW + 6 * MIN }, { unlock: { iat: NOW } }), {
  ok: false,
  code: "future",
});
add(
  "stale-25h",
  "§3.3 check 5: at most 24 hours old at the machine",
  viaGrant({ iat: NOW - 25 * HOUR }, { unlock: { iat: NOW - 25.5 * HOUR } }),
  { ok: false, code: "stale" },
);
add(
  "receiver-stale",
  "§3.2 a receiver refuses to queue a command over 10 minutes old",
  viaGrant({ iat: NOW - 11 * MIN }),
  { ok: false, code: "stale" },
  { max_age_ms: 10 * MIN },
);
add(
  "receiver-grant-over",
  "§3.2 a receiver refuses an unlock that has run out",
  viaGrant({ iat: NOW - 3 * MIN }, { unlock: { iat: NOW - 24 * HOUR, exp: NOW - MIN } }),
  { ok: false, code: "grant" },
  { max_age_ms: 10 * MIN, live_grant: true },
);

// broken: who signed
add("unsigned", "§3.3 check 3: no grant+csig, no confirm", { cmd: command({}) }, { ok: false, code: "unsigned" });
add("grant-without-csig", "§3.3 check 4", (({ csig, ...r }) => r)(viaGrant({})), { ok: false, code: "unsigned" });
add("untrusted-passkey", "§3.3 check 3: a passkey not enrolled here", viaGrant({}, { pk: mallory }), {
  ok: false,
  code: "untrusted",
});
add("untrusted-confirm", "§3.3 check 3", viaConfirm({}, { pk: mallory }), { ok: false, code: "untrusted" });
add(
  "confirm-other-command",
  "§3.3 check 3: the confirm is over sha256(these bytes)",
  viaConfirm({}, { signed: command({}) }),
  { ok: false, code: "assertion" },
);
add(
  "csig-other-key",
  "§3.3 check 4: the unlock's day key, no other",
  viaGrant({}, { dayKey: generateKeyPairSync("ec", { namedCurve: "prime256v1" }) }),
  { ok: false, code: "csig" },
);
add(
  "grant-too-long",
  "§3.3 check 3: an unlock lasts ≤ 24 h",
  viaGrant({}, { unlock: { exp: NOW - 2 * HOUR + 25 * HOUR + 6 * MIN } }),
  { ok: false, code: "grant" },
);
add(
  "grant-other-rp",
  "§3.3 check 3: the unlock names the passkey's site",
  viaGrant({}, { unlock: { rp: "evil.example" } }),
  { ok: false, code: "grant" },
);
add("grant-legacy-type", "§3.3 t is sessionpipe.grant", viaGrant({}, { unlock: { t: "ss-machine-grant" } }), {
  ok: false,
  code: "grant",
});
add(
  "outside-window",
  "§3.3 check 3: iat inside the unlock",
  viaGrant({ iat: NOW - 5 * MIN }, { unlock: { iat: NOW - 30 * HOUR, exp: NOW - 7 * HOUR } }),
  { ok: false, code: "window" },
);
add(
  "before-window",
  "§3.3 check 3: iat inside the unlock",
  viaGrant({ iat: NOW - 3 * HOUR }, { unlock: { iat: NOW - HOUR } }),
  { ok: false, code: "window" },
);
add("no-user-verified", "§4 UV: a fingerprint, face or PIN", viaConfirm({}, { assertion: { flags: 0x01 } }), {
  ok: false,
  code: "assertion",
});
add("no-user-present", "§4 UP", viaGrant({}, { unlock: { assertion: { flags: 0x04 } } }), {
  ok: false,
  code: "assertion",
});
add(
  "wrong-origin",
  "§4 the assertion was made on the passkey's site",
  viaConfirm({}, { assertion: { origin: "https://receiver.example.evil.test" } }),
  { ok: false, code: "assertion" },
);
add("http-origin", "§4 https only, except localhost", viaConfirm({}, { assertion: { origin: `http://${RP}` } }), {
  ok: false,
  code: "assertion",
});
add("cross-origin", "§4 never inside another site's frame", viaConfirm({}, { assertion: { crossOrigin: true } }), {
  ok: false,
  code: "assertion",
});
add(
  "create-not-get",
  "§4 an assertion (webauthn.get), not a registration",
  viaConfirm({}, { assertion: { type: "webauthn.create" } }),
  { ok: false, code: "assertion" },
);
add("other-rp-authdata", "§4 rpIdHash is the passkey's site", viaConfirm({}, { assertion: { rp: "evil.example" } }), {
  ok: false,
  code: "assertion",
});

// localhost is its own rp: http allowed there only
const dev = passkey();
const devKeys = [dev.trusted("localhost")];
{
  const cmd = command({});
  add(
    "localhost-http",
    "§4 http on localhost (a dev receiver)",
    { cmd, confirm: assert(dev, sha(Buffer.from(cmd)), { rp: "localhost", origin: "http://localhost:8791" }) },
    { ok: true, via: "confirm" },
    { keys: devKeys },
  );
}

// --- write -------------------------------------------------------------------------

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const [i, c] of cases.entries()) {
  const file = `${String(i + 1).padStart(2, "0")}-${c.name}.json`;
  const body = {
    name: c.name,
    spec: `CONTROL.md ${c.spec}`,
    now: NOW,
    machine: MACHINE,
    keys: c.keys ?? keys,
    ...(c.max_age_ms ? { max_age_ms: c.max_age_ms } : {}),
    ...(c.live_grant ? { live_grant: true } : {}),
    input: c.input,
    expect: c.expect,
  };
  writeFileSync(path.join(out, file), `${JSON.stringify(body, null, 2)}\n`);
}
console.log(`control-vectors: wrote ${cases.length} (${readdirSync(out).length} files)`);
