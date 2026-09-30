// SPDX-License-Identifier: Apache-2.0
// The one source for the protocol's shapes. schemas/v1/*.json are GENERATED from
// this file (`npm run schemas`); core's runtime types are inferred from it with
// type-only imports, so zod never enters the zero-dependency bundle. Prose lives in
// spec/PROTOCOL.md; a rule that is not encoded here is a MUST in words only.
import { z } from "zod";

export const PROTOCOL = 1;

/** Dotted, lowercase. Unknown types MUST be accepted and stored. */
export const EventType = z
  .string()
  .regex(/^(?:native|[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+)$/, "dotted lowercase type, or native");

export const KNOWN_TYPES = [
  "session.started",
  "session.heartbeat",
  "session.ended",
  "session.backfill",
  "session.forgotten",
  "turn.started",
  "turn.ended",
  "turn.transcript",
  "tool.started",
  "tool.ended",
  "files.changed",
  "attention.needed",
  "attention.cleared",
  "subagent.started",
  "subagent.ended",
  "context.compacted",
  "native",
] as const;

/** The lowest tier that carries each known type. */
export const TYPE_TIER: Record<(typeof KNOWN_TYPES)[number], 0 | 1 | 2 | 3> = {
  "session.started": 0,
  "session.heartbeat": 0,
  "session.ended": 0,
  "session.backfill": 0,
  "session.forgotten": 0,
  "turn.started": 0,
  "turn.ended": 0,
  "turn.transcript": 2,
  "tool.started": 1,
  "tool.ended": 1,
  "files.changed": 1,
  "attention.needed": 0,
  "attention.cleared": 0,
  "subagent.started": 1,
  "subagent.ended": 1,
  "context.compacted": 1,
  native: 3,
};

export const HARNESS_NAMES = [
  "claude-code",
  "codex",
  "gemini-cli",
  "antigravity",
  "cursor",
  "copilot-cli",
  "droid",
  "kiro",
  "opencode",
] as const;

export const Tier = z.int().min(0).max(3);
export const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "ULID");
export const Rfc3339 = z.iso.datetime({ offset: false, precision: 3 });
export const SessionId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
export const ToolName = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);

export const Harness = z.object({
  /** From the registry in ADAPTERS.md; a name outside it is allowed ([a-z0-9-]). */
  name: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  version: z.string().max(64).optional(),
  /** The harness's own event name (`PostToolUse`, `agentStop`). */
  event: z.string().max(64).optional(),
});

export const Session = z.object({
  id: SessionId,
  /** Monotonic per session per sender; the dedup key with harness.name and id. */
  seq: z.int().min(0),
  machine: z.string().max(80).optional(),
  /** Home is written `~`. */
  cwd: z.string().max(1024).optional(),
  /** A remote URL with credentials stripped. */
  repo: z.string().max(512).optional(),
  branch: z.string().max(256).optional(),
  model: z.string().max(128).optional(),
  title: z.string().max(200).optional(),
  title_source: z.enum(["custom", "harness", "first-ask"]).optional(),
  url: z.url().max(1024).optional(),
  /** An id, never an email. */
  account_id: z.string().max(128).optional(),
  parent_id: SessionId.nullable().optional(),
});

export const Privacy = z.object({
  /** The redaction rulesets that ran; `secrets@1` always above tier 0. */
  rulesets: z.array(z.string().regex(/^[a-z][a-z0-9-]*@\d+$/)),
  pii: z.boolean(),
});

export const Event = z.object({
  protocol: z.literal(PROTOCOL),
  id: Ulid,
  type: EventType,
  time: Rfc3339,
  tier: Tier,
  harness: Harness,
  session: Session,
  privacy: Privacy,
  /** Per type (see EventData); extra keys allowed and kept. */
  data: z.record(z.string(), z.unknown()),
});

// --- data per type --------------------------------------------------------------

const Loose = z.object({}).loose();
export const AttentionKind = z.enum(["permission", "question", "elicitation", "idle", "error"]);

export const EventData = z.object({
  "session.started": Loose.extend({ source: z.enum(["startup", "resume", "clear", "compact", "fork", "unknown"]) }),
  "session.heartbeat": Loose,
  "session.ended": Loose.extend({ reason: z.enum(["clear", "logout", "exit", "other"]) }),
  "session.backfill": Loose.extend({ started_at: Rfc3339, last_at: Rfc3339, turns: z.int().min(0).optional() }),
  "session.forgotten": Loose,
  "turn.started": Loose.extend({ turn_id: z.string().max(128).optional(), prompt_chars: z.int().min(0).optional() }),
  "turn.ended": Loose.extend({
    turn_id: z.string().max(128).optional(),
    reason: z.enum(["stop", "interrupt", "error"]),
    /** The harness's error class when reason is error (rate_limit, overloaded, authentication_failed, server_error …). */
    error: z.string().max(200).optional(),
    ms: z.int().min(0).optional(),
  }),
  "turn.transcript": Loose.extend({
    turn: z.int().min(0),
    user: z.string().max(20_000),
    assistant: z.string().max(20_000),
    at: Rfc3339,
  }),
  "tool.started": Loose.extend({
    tool: ToolName,
    call_id: z.string().max(128).optional(),
    turn_id: z.string().max(128).optional(),
    /** Set when a subagent made the call. */
    agent_id: z.string().max(128).optional(),
    input: z.unknown().optional(),
  }),
  "tool.ended": Loose.extend({
    tool: ToolName,
    call_id: z.string().max(128).optional(),
    turn_id: z.string().max(128).optional(),
    agent_id: z.string().max(128).optional(),
    ms: z.int().min(0).optional(),
    ok: z.boolean(),
    error: z.string().max(2000).optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
  }),
  "files.changed": Loose.extend({ paths: z.array(z.string().max(1024)).max(500) }),
  "attention.needed": Loose.extend({
    attention_id: z.string().max(128),
    kind: AttentionKind,
    tool: ToolName.optional(),
    message: z.string().max(200).optional(),
  }),
  "attention.cleared": Loose.extend({
    attention_id: z.string().max(128),
    how: z.enum(["answered", "cancelled", "timeout", "unknown"]),
  }),
  "subagent.started": Loose.extend({ agent_id: z.string().max(128), agent_type: z.string().max(128).optional() }),
  "subagent.ended": Loose.extend({ agent_id: z.string().max(128), agent_type: z.string().max(128).optional() }),
  "context.compacted": Loose.extend({ trigger: z.enum(["manual", "auto"]) }),
  native: Loose,
});

// --- wire -----------------------------------------------------------------------

export const Batch = z.object({ events: z.array(Event).min(1).max(50) });

export const BatchResponse = z.object({
  accepted: z.int().min(0),
  duplicates: z.int().min(0),
  rejected: z.array(z.object({ id: Ulid, reason: z.string().max(200) })),
  max_tier: Tier,
});

export const ErrorResponse = z.object({
  reason: z.string().max(200),
  supported: z.array(z.int()).optional(),
  max_tier: Tier.optional(),
});

export const Capability = z.enum(["events", "backfill", "forget", "control", "native"]);

export const WellKnown = z.object({
  protocol: z.array(z.int().min(1)).min(1),
  max_tier: Tier,
  capabilities: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)),
  auth: z.array(z.enum(["bearer"])).default(["bearer"]),
  endpoints: z.object({
    events: z.string(),
    control: z.string().optional(),
    native: z.string().optional(),
  }),
  batch: z.object({ max_events: z.int().min(1).max(50), max_bytes: z.int().min(1024).max(262_144) }),
  control: z
    .object({
      wait_max_s: z.int().min(1).max(60),
      /** How commands for this receiver's people are signed (CONTROL.md §4). */
      signing: z.object({
        /** The WebAuthn relying party id every enrolled passkey belongs to. */
        rp: z.string().min(1).max(253),
        /** COSE algorithms a passkey may use: -7 (ES256) and -257 (RS256). */
        algs: z.array(z.union([z.literal(-7), z.literal(-257)])).min(1),
      }),
    })
    .optional(),
});

/** A machine id: `m_` + 16–40 base64url. */
export const MachineId = z.string().regex(/^m_[A-Za-z0-9_-]{16,40}$/);
const B64u = z.string().regex(/^[A-Za-z0-9_-]*$/, "base64url, no padding");

export const ControlKind = z.enum(["prompt", "permission.answer", "cancel", "start"]);

/** The command's fields: what the signed string `cmd` parses to (CONTROL.md §3.1).
 *  Kind rules (text for prompt/start, for+decision for permission.answer, cwd only on
 *  start, nothing extra on cancel) and the 16 KiB cap on the string are enforced by
 *  the verifier in core (src/control/verify.ts), which is the normative check. */
export const ControlCommand = z.object({
  v: z.literal(1),
  t: z.literal("sessionpipe.control"),
  machine: MachineId,
  kind: ControlKind,
  /** `<harness>:<id>`; the id follows the adapter's shape (Claude Code, Codex: UUID). */
  session: z.string().regex(/^[a-z][a-z0-9-]{0,31}:[A-Za-z0-9._-]{1,128}$/),
  text: z.string().max(12_000).optional(),
  for: z
    .string()
    .regex(/^[A-Za-z0-9._:-]{1,128}$/)
    .optional(),
  decision: z.enum(["allow", "deny"]).optional(),
  note: z.string().max(2000).optional(),
  /** start only: the absolute folder the new session starts in. */
  cwd: z.string().max(400).optional(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{22,64}$/),
  /** Signing time, epoch ms. */
  iat: z.number(),
});

/** The day unlock a passkey signs: `grant.str` parses to this. */
export const ControlGrant = z.object({
  v: z.literal(1),
  t: z.literal("sessionpipe.grant"),
  /** SPKI DER of the ECDSA P-256 day key, base64url. */
  pub: B64u.min(1),
  iat: z.number(),
  /** At most 24 hours after iat. */
  exp: z.number(),
  rp: z.string().min(1).max(253),
});

/** A WebAuthn assertion: credential id, authenticatorData, clientDataJSON, signature. */
export const Assertion = z.object({ cred: B64u.min(1), ad: B64u.min(1), cd: B64u.min(1), sig: B64u.min(1) });

/** One queued command as a machine receives it. Either `csig` + `grant`, or `confirm`. */
export const ControlEnvelope = z.object({
  /** The receiver's id for this delivery; the ack key. */
  id: Ulid,
  /** The exact signed bytes. Parse to read; never re-serialize to verify. */
  cmd: z.string().max(16_384),
  /** The day key's ECDSA P-256 signature over cmd, raw r||s, base64url. */
  csig: B64u.length(86).optional(),
  grant: Assertion.extend({ str: z.string().max(2000) }).optional(),
  /** A passkey assertion over sha256(cmd). */
  confirm: Assertion.optional(),
  at: Rfc3339,
  /** After this the machine MUST NOT act and MUST ack `expired`. */
  expires_at: Rfc3339,
});

/** A passkey enrolled at a machine's own terminal. */
export const ControlKey = z.object({
  id: B64u.min(16).max(1400),
  alg: z.union([z.literal(-7), z.literal(-257)]),
  /** SPKI DER, base64url. */
  spki: B64u.min(1),
  rp: z.string().min(1).max(253),
  name: z.string().max(80).optional(),
  added_at: Rfc3339.optional(),
});

export const ControlPoll = z.object({ messages: z.array(ControlEnvelope).max(20) });

export const DeliveryMode = z.enum(["sdk", "waiter", "turn", "api", "resume", "fork"]);

export const ControlAck = z.object({
  acks: z
    .array(
      z.object({
        id: Ulid,
        outcome: z.enum(["delivered", "expired", "unsupported", "failed", "refused"]),
        /** delivered only: how it reached the session. */
        mode: DeliveryMode.optional(),
        /** refused only: the verifier's code (CONTROL.md §3.3). */
        code: z.string().max(40).optional(),
        at: Rfc3339,
        /** Receive → delivered on the machine's clock. */
        ms: z.int().min(0).optional(),
        detail: z.string().max(500).optional(),
      }),
    )
    .min(1),
});

/** What `npm run schemas` writes to schemas/v1/<name>.json. */
export const SCHEMAS = {
  event: Event,
  "event-data": EventData,
  batch: Batch,
  "batch-response": BatchResponse,
  error: ErrorResponse,
  "well-known": WellKnown,
  control: ControlCommand,
  "control-grant": ControlGrant,
  "control-envelope": ControlEnvelope,
  "control-key": ControlKey,
  "control-poll": ControlPoll,
  "control-ack": ControlAck,
} as const;
