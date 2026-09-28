import { z } from "zod";
export declare const PROTOCOL = 1;
/** Dotted, lowercase. Unknown types MUST be accepted and stored. */
export declare const EventType: z.ZodString;
export declare const KNOWN_TYPES: readonly [
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
];
/** The lowest tier that carries each known type. */
export declare const TYPE_TIER: Record<(typeof KNOWN_TYPES)[number], 0 | 1 | 2 | 3>;
export declare const HARNESS_NAMES: readonly [
  "claude-code",
  "codex",
  "gemini-cli",
  "antigravity",
  "cursor",
  "copilot-cli",
  "droid",
  "kiro",
  "opencode",
];
export declare const Tier: z.ZodInt;
export declare const Ulid: z.ZodString;
export declare const Rfc3339: z.ZodISODateTime;
export declare const SessionId: z.ZodString;
export declare const ToolName: z.ZodString;
export declare const Harness: z.ZodObject<
  {
    name: z.ZodString;
    version: z.ZodOptional<z.ZodString>;
    event: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export declare const Session: z.ZodObject<
  {
    id: z.ZodString;
    seq: z.ZodInt;
    machine: z.ZodOptional<z.ZodString>;
    cwd: z.ZodOptional<z.ZodString>;
    repo: z.ZodOptional<z.ZodString>;
    branch: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    title: z.ZodOptional<z.ZodString>;
    title_source: z.ZodOptional<
      z.ZodEnum<{
        custom: "custom";
        harness: "harness";
        "first-ask": "first-ask";
      }>
    >;
    url: z.ZodOptional<z.ZodURL>;
    account_id: z.ZodOptional<z.ZodString>;
    parent_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  },
  z.core.$strip
>;
export declare const Privacy: z.ZodObject<
  {
    rulesets: z.ZodArray<z.ZodString>;
    pii: z.ZodBoolean;
  },
  z.core.$strip
>;
export declare const Event: z.ZodObject<
  {
    protocol: z.ZodLiteral<1>;
    id: z.ZodString;
    type: z.ZodString;
    time: z.ZodISODateTime;
    tier: z.ZodInt;
    harness: z.ZodObject<
      {
        name: z.ZodString;
        version: z.ZodOptional<z.ZodString>;
        event: z.ZodOptional<z.ZodString>;
      },
      z.core.$strip
    >;
    session: z.ZodObject<
      {
        id: z.ZodString;
        seq: z.ZodInt;
        machine: z.ZodOptional<z.ZodString>;
        cwd: z.ZodOptional<z.ZodString>;
        repo: z.ZodOptional<z.ZodString>;
        branch: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        title: z.ZodOptional<z.ZodString>;
        title_source: z.ZodOptional<
          z.ZodEnum<{
            custom: "custom";
            harness: "harness";
            "first-ask": "first-ask";
          }>
        >;
        url: z.ZodOptional<z.ZodURL>;
        account_id: z.ZodOptional<z.ZodString>;
        parent_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
      },
      z.core.$strip
    >;
    privacy: z.ZodObject<
      {
        rulesets: z.ZodArray<z.ZodString>;
        pii: z.ZodBoolean;
      },
      z.core.$strip
    >;
    data: z.ZodRecord<z.ZodString, z.ZodUnknown>;
  },
  z.core.$strip
>;
export declare const AttentionKind: z.ZodEnum<{
  error: "error";
  permission: "permission";
  question: "question";
  elicitation: "elicitation";
  idle: "idle";
}>;
export declare const EventData: z.ZodObject<
  {
    "session.started": z.ZodObject<
      {
        source: z.ZodEnum<{
          unknown: "unknown";
          startup: "startup";
          resume: "resume";
          clear: "clear";
          compact: "compact";
          fork: "fork";
        }>;
      },
      z.core.$loose
    >;
    "session.heartbeat": z.ZodObject<{}, z.core.$loose>;
    "session.ended": z.ZodObject<
      {
        reason: z.ZodEnum<{
          clear: "clear";
          logout: "logout";
          exit: "exit";
          other: "other";
        }>;
      },
      z.core.$loose
    >;
    "session.backfill": z.ZodObject<
      {
        started_at: z.ZodISODateTime;
        last_at: z.ZodISODateTime;
        turns: z.ZodOptional<z.ZodInt>;
      },
      z.core.$loose
    >;
    "session.forgotten": z.ZodObject<{}, z.core.$loose>;
    "turn.started": z.ZodObject<
      {
        turn_id: z.ZodOptional<z.ZodString>;
        prompt_chars: z.ZodOptional<z.ZodInt>;
      },
      z.core.$loose
    >;
    "turn.ended": z.ZodObject<
      {
        turn_id: z.ZodOptional<z.ZodString>;
        reason: z.ZodEnum<{
          error: "error";
          stop: "stop";
          interrupt: "interrupt";
        }>;
        ms: z.ZodOptional<z.ZodInt>;
      },
      z.core.$loose
    >;
    "turn.transcript": z.ZodObject<
      {
        turn: z.ZodInt;
        user: z.ZodString;
        assistant: z.ZodString;
        at: z.ZodISODateTime;
      },
      z.core.$loose
    >;
    "tool.started": z.ZodObject<
      {
        tool: z.ZodString;
        call_id: z.ZodOptional<z.ZodString>;
        turn_id: z.ZodOptional<z.ZodString>;
        input: z.ZodOptional<z.ZodUnknown>;
      },
      z.core.$loose
    >;
    "tool.ended": z.ZodObject<
      {
        tool: z.ZodString;
        call_id: z.ZodOptional<z.ZodString>;
        turn_id: z.ZodOptional<z.ZodString>;
        ms: z.ZodOptional<z.ZodInt>;
        ok: z.ZodBoolean;
        error: z.ZodOptional<z.ZodString>;
        input: z.ZodOptional<z.ZodUnknown>;
        output: z.ZodOptional<z.ZodUnknown>;
      },
      z.core.$loose
    >;
    "files.changed": z.ZodObject<
      {
        paths: z.ZodArray<z.ZodString>;
      },
      z.core.$loose
    >;
    "attention.needed": z.ZodObject<
      {
        attention_id: z.ZodString;
        kind: z.ZodEnum<{
          error: "error";
          permission: "permission";
          question: "question";
          elicitation: "elicitation";
          idle: "idle";
        }>;
        tool: z.ZodOptional<z.ZodString>;
        message: z.ZodOptional<z.ZodString>;
      },
      z.core.$loose
    >;
    "attention.cleared": z.ZodObject<
      {
        attention_id: z.ZodString;
        how: z.ZodEnum<{
          unknown: "unknown";
          answered: "answered";
          cancelled: "cancelled";
          timeout: "timeout";
        }>;
      },
      z.core.$loose
    >;
    "subagent.started": z.ZodObject<
      {
        agent_id: z.ZodString;
        agent_type: z.ZodOptional<z.ZodString>;
      },
      z.core.$loose
    >;
    "subagent.ended": z.ZodObject<
      {
        agent_id: z.ZodString;
        agent_type: z.ZodOptional<z.ZodString>;
      },
      z.core.$loose
    >;
    "context.compacted": z.ZodObject<
      {
        trigger: z.ZodEnum<{
          manual: "manual";
          auto: "auto";
        }>;
      },
      z.core.$loose
    >;
    native: z.ZodObject<{}, z.core.$loose>;
  },
  z.core.$strip
>;
export declare const Batch: z.ZodObject<
  {
    events: z.ZodArray<
      z.ZodObject<
        {
          protocol: z.ZodLiteral<1>;
          id: z.ZodString;
          type: z.ZodString;
          time: z.ZodISODateTime;
          tier: z.ZodInt;
          harness: z.ZodObject<
            {
              name: z.ZodString;
              version: z.ZodOptional<z.ZodString>;
              event: z.ZodOptional<z.ZodString>;
            },
            z.core.$strip
          >;
          session: z.ZodObject<
            {
              id: z.ZodString;
              seq: z.ZodInt;
              machine: z.ZodOptional<z.ZodString>;
              cwd: z.ZodOptional<z.ZodString>;
              repo: z.ZodOptional<z.ZodString>;
              branch: z.ZodOptional<z.ZodString>;
              model: z.ZodOptional<z.ZodString>;
              title: z.ZodOptional<z.ZodString>;
              title_source: z.ZodOptional<
                z.ZodEnum<{
                  custom: "custom";
                  harness: "harness";
                  "first-ask": "first-ask";
                }>
              >;
              url: z.ZodOptional<z.ZodURL>;
              account_id: z.ZodOptional<z.ZodString>;
              parent_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            },
            z.core.$strip
          >;
          privacy: z.ZodObject<
            {
              rulesets: z.ZodArray<z.ZodString>;
              pii: z.ZodBoolean;
            },
            z.core.$strip
          >;
          data: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export declare const BatchResponse: z.ZodObject<
  {
    accepted: z.ZodInt;
    duplicates: z.ZodInt;
    rejected: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          reason: z.ZodString;
        },
        z.core.$strip
      >
    >;
    max_tier: z.ZodInt;
  },
  z.core.$strip
>;
export declare const ErrorResponse: z.ZodObject<
  {
    reason: z.ZodString;
    supported: z.ZodOptional<z.ZodArray<z.ZodInt>>;
    max_tier: z.ZodOptional<z.ZodInt>;
  },
  z.core.$strip
>;
export declare const Capability: z.ZodEnum<{
  native: "native";
  events: "events";
  backfill: "backfill";
  forget: "forget";
  control: "control";
}>;
export declare const WellKnown: z.ZodObject<
  {
    protocol: z.ZodArray<z.ZodInt>;
    max_tier: z.ZodInt;
    capabilities: z.ZodArray<z.ZodString>;
    auth: z.ZodDefault<
      z.ZodArray<
        z.ZodEnum<{
          bearer: "bearer";
        }>
      >
    >;
    endpoints: z.ZodObject<
      {
        events: z.ZodString;
        control: z.ZodOptional<z.ZodString>;
        native: z.ZodOptional<z.ZodString>;
      },
      z.core.$strip
    >;
    batch: z.ZodObject<
      {
        max_events: z.ZodInt;
        max_bytes: z.ZodInt;
      },
      z.core.$strip
    >;
    control: z.ZodOptional<
      z.ZodObject<
        {
          wait_max_s: z.ZodInt;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export declare const ControlKind: z.ZodEnum<{
  "permission.answer": "permission.answer";
  prompt: "prompt";
  cancel: "cancel";
}>;
export declare const ControlMessage: z.ZodObject<
  {
    id: z.ZodString;
    kind: z.ZodEnum<{
      "permission.answer": "permission.answer";
      prompt: "prompt";
      cancel: "cancel";
    }>;
    for: z.ZodOptional<z.ZodString>;
    decision: z.ZodOptional<
      z.ZodEnum<{
        allow: "allow";
        deny: "deny";
      }>
    >;
    text: z.ZodOptional<z.ZodString>;
    note: z.ZodOptional<z.ZodString>;
    at: z.ZodISODateTime;
    expires_at: z.ZodISODateTime;
  },
  z.core.$strip
>;
export declare const ControlPoll: z.ZodObject<
  {
    messages: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          kind: z.ZodEnum<{
            "permission.answer": "permission.answer";
            prompt: "prompt";
            cancel: "cancel";
          }>;
          for: z.ZodOptional<z.ZodString>;
          decision: z.ZodOptional<
            z.ZodEnum<{
              allow: "allow";
              deny: "deny";
            }>
          >;
          text: z.ZodOptional<z.ZodString>;
          note: z.ZodOptional<z.ZodString>;
          at: z.ZodISODateTime;
          expires_at: z.ZodISODateTime;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export declare const ControlAck: z.ZodObject<
  {
    acks: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          outcome: z.ZodEnum<{
            delivered: "delivered";
            expired: "expired";
            unsupported: "unsupported";
            failed: "failed";
          }>;
          at: z.ZodISODateTime;
          detail: z.ZodOptional<z.ZodString>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
/** What `npm run schemas` writes to schemas/v1/<name>.json. */
export declare const SCHEMAS: {
  readonly event: z.ZodObject<
    {
      protocol: z.ZodLiteral<1>;
      id: z.ZodString;
      type: z.ZodString;
      time: z.ZodISODateTime;
      tier: z.ZodInt;
      harness: z.ZodObject<
        {
          name: z.ZodString;
          version: z.ZodOptional<z.ZodString>;
          event: z.ZodOptional<z.ZodString>;
        },
        z.core.$strip
      >;
      session: z.ZodObject<
        {
          id: z.ZodString;
          seq: z.ZodInt;
          machine: z.ZodOptional<z.ZodString>;
          cwd: z.ZodOptional<z.ZodString>;
          repo: z.ZodOptional<z.ZodString>;
          branch: z.ZodOptional<z.ZodString>;
          model: z.ZodOptional<z.ZodString>;
          title: z.ZodOptional<z.ZodString>;
          title_source: z.ZodOptional<
            z.ZodEnum<{
              custom: "custom";
              harness: "harness";
              "first-ask": "first-ask";
            }>
          >;
          url: z.ZodOptional<z.ZodURL>;
          account_id: z.ZodOptional<z.ZodString>;
          parent_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        },
        z.core.$strip
      >;
      privacy: z.ZodObject<
        {
          rulesets: z.ZodArray<z.ZodString>;
          pii: z.ZodBoolean;
        },
        z.core.$strip
      >;
      data: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    },
    z.core.$strip
  >;
  readonly "event-data": z.ZodObject<
    {
      "session.started": z.ZodObject<
        {
          source: z.ZodEnum<{
            unknown: "unknown";
            startup: "startup";
            resume: "resume";
            clear: "clear";
            compact: "compact";
            fork: "fork";
          }>;
        },
        z.core.$loose
      >;
      "session.heartbeat": z.ZodObject<{}, z.core.$loose>;
      "session.ended": z.ZodObject<
        {
          reason: z.ZodEnum<{
            clear: "clear";
            logout: "logout";
            exit: "exit";
            other: "other";
          }>;
        },
        z.core.$loose
      >;
      "session.backfill": z.ZodObject<
        {
          started_at: z.ZodISODateTime;
          last_at: z.ZodISODateTime;
          turns: z.ZodOptional<z.ZodInt>;
        },
        z.core.$loose
      >;
      "session.forgotten": z.ZodObject<{}, z.core.$loose>;
      "turn.started": z.ZodObject<
        {
          turn_id: z.ZodOptional<z.ZodString>;
          prompt_chars: z.ZodOptional<z.ZodInt>;
        },
        z.core.$loose
      >;
      "turn.ended": z.ZodObject<
        {
          turn_id: z.ZodOptional<z.ZodString>;
          reason: z.ZodEnum<{
            error: "error";
            stop: "stop";
            interrupt: "interrupt";
          }>;
          ms: z.ZodOptional<z.ZodInt>;
        },
        z.core.$loose
      >;
      "turn.transcript": z.ZodObject<
        {
          turn: z.ZodInt;
          user: z.ZodString;
          assistant: z.ZodString;
          at: z.ZodISODateTime;
        },
        z.core.$loose
      >;
      "tool.started": z.ZodObject<
        {
          tool: z.ZodString;
          call_id: z.ZodOptional<z.ZodString>;
          turn_id: z.ZodOptional<z.ZodString>;
          input: z.ZodOptional<z.ZodUnknown>;
        },
        z.core.$loose
      >;
      "tool.ended": z.ZodObject<
        {
          tool: z.ZodString;
          call_id: z.ZodOptional<z.ZodString>;
          turn_id: z.ZodOptional<z.ZodString>;
          ms: z.ZodOptional<z.ZodInt>;
          ok: z.ZodBoolean;
          error: z.ZodOptional<z.ZodString>;
          input: z.ZodOptional<z.ZodUnknown>;
          output: z.ZodOptional<z.ZodUnknown>;
        },
        z.core.$loose
      >;
      "files.changed": z.ZodObject<
        {
          paths: z.ZodArray<z.ZodString>;
        },
        z.core.$loose
      >;
      "attention.needed": z.ZodObject<
        {
          attention_id: z.ZodString;
          kind: z.ZodEnum<{
            error: "error";
            permission: "permission";
            question: "question";
            elicitation: "elicitation";
            idle: "idle";
          }>;
          tool: z.ZodOptional<z.ZodString>;
          message: z.ZodOptional<z.ZodString>;
        },
        z.core.$loose
      >;
      "attention.cleared": z.ZodObject<
        {
          attention_id: z.ZodString;
          how: z.ZodEnum<{
            unknown: "unknown";
            answered: "answered";
            cancelled: "cancelled";
            timeout: "timeout";
          }>;
        },
        z.core.$loose
      >;
      "subagent.started": z.ZodObject<
        {
          agent_id: z.ZodString;
          agent_type: z.ZodOptional<z.ZodString>;
        },
        z.core.$loose
      >;
      "subagent.ended": z.ZodObject<
        {
          agent_id: z.ZodString;
          agent_type: z.ZodOptional<z.ZodString>;
        },
        z.core.$loose
      >;
      "context.compacted": z.ZodObject<
        {
          trigger: z.ZodEnum<{
            manual: "manual";
            auto: "auto";
          }>;
        },
        z.core.$loose
      >;
      native: z.ZodObject<{}, z.core.$loose>;
    },
    z.core.$strip
  >;
  readonly batch: z.ZodObject<
    {
      events: z.ZodArray<
        z.ZodObject<
          {
            protocol: z.ZodLiteral<1>;
            id: z.ZodString;
            type: z.ZodString;
            time: z.ZodISODateTime;
            tier: z.ZodInt;
            harness: z.ZodObject<
              {
                name: z.ZodString;
                version: z.ZodOptional<z.ZodString>;
                event: z.ZodOptional<z.ZodString>;
              },
              z.core.$strip
            >;
            session: z.ZodObject<
              {
                id: z.ZodString;
                seq: z.ZodInt;
                machine: z.ZodOptional<z.ZodString>;
                cwd: z.ZodOptional<z.ZodString>;
                repo: z.ZodOptional<z.ZodString>;
                branch: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                title: z.ZodOptional<z.ZodString>;
                title_source: z.ZodOptional<
                  z.ZodEnum<{
                    custom: "custom";
                    harness: "harness";
                    "first-ask": "first-ask";
                  }>
                >;
                url: z.ZodOptional<z.ZodURL>;
                account_id: z.ZodOptional<z.ZodString>;
                parent_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
              },
              z.core.$strip
            >;
            privacy: z.ZodObject<
              {
                rulesets: z.ZodArray<z.ZodString>;
                pii: z.ZodBoolean;
              },
              z.core.$strip
            >;
            data: z.ZodRecord<z.ZodString, z.ZodUnknown>;
          },
          z.core.$strip
        >
      >;
    },
    z.core.$strip
  >;
  readonly "batch-response": z.ZodObject<
    {
      accepted: z.ZodInt;
      duplicates: z.ZodInt;
      rejected: z.ZodArray<
        z.ZodObject<
          {
            id: z.ZodString;
            reason: z.ZodString;
          },
          z.core.$strip
        >
      >;
      max_tier: z.ZodInt;
    },
    z.core.$strip
  >;
  readonly error: z.ZodObject<
    {
      reason: z.ZodString;
      supported: z.ZodOptional<z.ZodArray<z.ZodInt>>;
      max_tier: z.ZodOptional<z.ZodInt>;
    },
    z.core.$strip
  >;
  readonly "well-known": z.ZodObject<
    {
      protocol: z.ZodArray<z.ZodInt>;
      max_tier: z.ZodInt;
      capabilities: z.ZodArray<z.ZodString>;
      auth: z.ZodDefault<
        z.ZodArray<
          z.ZodEnum<{
            bearer: "bearer";
          }>
        >
      >;
      endpoints: z.ZodObject<
        {
          events: z.ZodString;
          control: z.ZodOptional<z.ZodString>;
          native: z.ZodOptional<z.ZodString>;
        },
        z.core.$strip
      >;
      batch: z.ZodObject<
        {
          max_events: z.ZodInt;
          max_bytes: z.ZodInt;
        },
        z.core.$strip
      >;
      control: z.ZodOptional<
        z.ZodObject<
          {
            wait_max_s: z.ZodInt;
          },
          z.core.$strip
        >
      >;
    },
    z.core.$strip
  >;
  readonly control: z.ZodObject<
    {
      id: z.ZodString;
      kind: z.ZodEnum<{
        "permission.answer": "permission.answer";
        prompt: "prompt";
        cancel: "cancel";
      }>;
      for: z.ZodOptional<z.ZodString>;
      decision: z.ZodOptional<
        z.ZodEnum<{
          allow: "allow";
          deny: "deny";
        }>
      >;
      text: z.ZodOptional<z.ZodString>;
      note: z.ZodOptional<z.ZodString>;
      at: z.ZodISODateTime;
      expires_at: z.ZodISODateTime;
    },
    z.core.$strip
  >;
  readonly "control-poll": z.ZodObject<
    {
      messages: z.ZodArray<
        z.ZodObject<
          {
            id: z.ZodString;
            kind: z.ZodEnum<{
              "permission.answer": "permission.answer";
              prompt: "prompt";
              cancel: "cancel";
            }>;
            for: z.ZodOptional<z.ZodString>;
            decision: z.ZodOptional<
              z.ZodEnum<{
                allow: "allow";
                deny: "deny";
              }>
            >;
            text: z.ZodOptional<z.ZodString>;
            note: z.ZodOptional<z.ZodString>;
            at: z.ZodISODateTime;
            expires_at: z.ZodISODateTime;
          },
          z.core.$strip
        >
      >;
    },
    z.core.$strip
  >;
  readonly "control-ack": z.ZodObject<
    {
      acks: z.ZodArray<
        z.ZodObject<
          {
            id: z.ZodString;
            outcome: z.ZodEnum<{
              delivered: "delivered";
              expired: "expired";
              unsupported: "unsupported";
              failed: "failed";
            }>;
            at: z.ZodISODateTime;
            detail: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >
      >;
    },
    z.core.$strip
  >;
};
//# sourceMappingURL=v1.d.ts.map
