import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  LeaseResponseSchema,
  LeasedEventSchema,
  ReportResponseSchema,
  TargetCircuitStateSchema,
  WebhookEventSchema,
  WebhookEventStatusSchema,
} from "./index.js";

const validWebhookEvent = {
  id: "evt_123",
  endpoint_id: "ep_456",
  provider: "stripe",
  headers: { "content-type": "application/json" },
  payload: '{"type":"payment.created"}',
  status: "pending" as const,
  attempts: 0,
  received_at: "2024-01-01T00:00:00Z",
  next_attempt_at: null,
  lease_expires_at: null,
  leased_by: null,
  last_error: null,
};

const validCircuit = {
  endpoint_id: "ep_456",
  state: "closed" as const,
  open_until: null,
  consecutive_failures: 0,
  last_failure_at: null,
};

const validLeasedEvent = {
  event: validWebhookEvent,
  target_url: "https://example.com/webhook",
  lease_expires_at: "2024-01-01T00:01:00Z",
  circuit: null,
};

describe("WebhookEventStatusSchema", () => {
  it("accepts valid status literals", () => {
    const statuses = ["pending", "in_flight", "requeued", "delivered", "dead", "paused"];
    for (const status of statuses) {
      const result = Schema.decodeUnknownEither(WebhookEventStatusSchema)(status);
      expect(Either.isRight(result)).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    const result = Schema.decodeUnknownEither(WebhookEventStatusSchema)("invalid");
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("TargetCircuitStateSchema", () => {
  it("accepts valid circuit state", () => {
    const result = Schema.decodeUnknownEither(TargetCircuitStateSchema)(validCircuit);
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts open circuit with open_until", () => {
    const openCircuit = {
      ...validCircuit,
      state: "open",
      open_until: "2024-01-01T00:05:00Z",
      consecutive_failures: 5,
      last_failure_at: "2024-01-01T00:00:00Z",
    };
    const result = Schema.decodeUnknownEither(TargetCircuitStateSchema)(openCircuit);
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects invalid state literal", () => {
    const result = Schema.decodeUnknownEither(TargetCircuitStateSchema)({
      ...validCircuit,
      state: "half-open",
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects missing endpoint_id", () => {
    const incomplete = {
      state: validCircuit.state,
      open_until: validCircuit.open_until,
      consecutive_failures: validCircuit.consecutive_failures,
      last_failure_at: validCircuit.last_failure_at,
    };
    const result = Schema.decodeUnknownEither(TargetCircuitStateSchema)(incomplete);
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("WebhookEventSchema", () => {
  it("accepts valid webhook event", () => {
    const result = Schema.decodeUnknownEither(WebhookEventSchema)(validWebhookEvent);
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts event with all nullable fields populated", () => {
    const fullEvent = {
      ...validWebhookEvent,
      next_attempt_at: "2024-01-01T00:01:00Z",
      lease_expires_at: "2024-01-01T00:02:00Z",
      leased_by: "worker-1",
      last_error: "Connection timeout",
    };
    const result = Schema.decodeUnknownEither(WebhookEventSchema)(fullEvent);
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects missing id", () => {
    const incomplete = {
      endpoint_id: validWebhookEvent.endpoint_id,
      provider: validWebhookEvent.provider,
      headers: validWebhookEvent.headers,
      payload: validWebhookEvent.payload,
      status: validWebhookEvent.status,
      attempts: validWebhookEvent.attempts,
      received_at: validWebhookEvent.received_at,
      next_attempt_at: validWebhookEvent.next_attempt_at,
      lease_expires_at: validWebhookEvent.lease_expires_at,
      leased_by: validWebhookEvent.leased_by,
      last_error: validWebhookEvent.last_error,
    };
    const result = Schema.decodeUnknownEither(WebhookEventSchema)(incomplete);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = Schema.decodeUnknownEither(WebhookEventSchema)({
      ...validWebhookEvent,
      status: "unknown",
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects attempts as string", () => {
    const result = Schema.decodeUnknownEither(WebhookEventSchema)({
      ...validWebhookEvent,
      attempts: "5",
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects non-object headers", () => {
    const result = Schema.decodeUnknownEither(WebhookEventSchema)({
      ...validWebhookEvent,
      headers: "invalid",
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("LeasedEventSchema", () => {
  it("accepts valid leased event with null circuit", () => {
    const result = Schema.decodeUnknownEither(LeasedEventSchema)(validLeasedEvent);
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts leased event with circuit", () => {
    const withCircuit = { ...validLeasedEvent, circuit: validCircuit };
    const result = Schema.decodeUnknownEither(LeasedEventSchema)(withCircuit);
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects missing event", () => {
    const incomplete = {
      target_url: validLeasedEvent.target_url,
      lease_expires_at: validLeasedEvent.lease_expires_at,
      circuit: validLeasedEvent.circuit,
    };
    const result = Schema.decodeUnknownEither(LeasedEventSchema)(incomplete);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects missing target_url", () => {
    const incomplete = {
      event: validLeasedEvent.event,
      lease_expires_at: validLeasedEvent.lease_expires_at,
      circuit: validLeasedEvent.circuit,
    };
    const result = Schema.decodeUnknownEither(LeasedEventSchema)(incomplete);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects invalid nested event", () => {
    const result = Schema.decodeUnknownEither(LeasedEventSchema)({
      ...validLeasedEvent,
      event: { id: "only-id" },
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects invalid circuit shape", () => {
    const result = Schema.decodeUnknownEither(LeasedEventSchema)({
      ...validLeasedEvent,
      circuit: { invalid: true },
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("LeaseResponseSchema", () => {
  it("accepts empty events array", () => {
    const result = Schema.decodeUnknownEither(LeaseResponseSchema)({ events: [] });
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts events array with valid leased events", () => {
    const result = Schema.decodeUnknownEither(LeaseResponseSchema)({
      events: [validLeasedEvent, { ...validLeasedEvent, circuit: validCircuit }],
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects missing events key", () => {
    const result = Schema.decodeUnknownEither(LeaseResponseSchema)({});
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects events as object instead of array", () => {
    const result = Schema.decodeUnknownEither(LeaseResponseSchema)({
      events: { 0: validLeasedEvent },
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects array with invalid event", () => {
    const result = Schema.decodeUnknownEither(LeaseResponseSchema)({
      events: [validLeasedEvent, { invalid: true }],
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("ReportResponseSchema", () => {
  it("accepts null circuit", () => {
    const result = Schema.decodeUnknownEither(ReportResponseSchema)({ circuit: null });
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts valid circuit", () => {
    const result = Schema.decodeUnknownEither(ReportResponseSchema)({
      circuit: validCircuit,
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects missing circuit key", () => {
    const result = Schema.decodeUnknownEither(ReportResponseSchema)({});
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects invalid circuit state literal", () => {
    const result = Schema.decodeUnknownEither(ReportResponseSchema)({
      circuit: { ...validCircuit, state: "half-open" },
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects circuit with wrong types", () => {
    const result = Schema.decodeUnknownEither(ReportResponseSchema)({
      circuit: { ...validCircuit, consecutive_failures: "many" },
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});
