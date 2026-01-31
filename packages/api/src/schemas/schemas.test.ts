import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ApiErrorCodeSchema,
  ApiErrorResponseSchema,
  GetEventResponseSchema,
  LeaseResponseSchema,
  LeasedEventSchema,
  ListAttemptsResponseSchema,
  ListEventsResponseSchema,
  ReplayEventResponseSchema,
  ReportResponseSchema,
  TargetCircuitStateSchema,
  WebhookAttemptErrorKindSchema,
  WebhookAttemptLogSchema,
  WebhookEventListItemSchema,
  WebhookEventSchema,
  WebhookEventStatusSchema,
  WebhookEventSummarySchema,
} from "./index.js";

const validWebhookEvent = {
  id: "evt_123",
  endpoint_id: "ep_456",
  replayed_from_event_id: null,
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

const validAttemptLog = {
  id: "att_123",
  event_id: "evt_123",
  attempt_no: 1,
  started_at: "2024-01-01T00:00:00Z",
  finished_at: "2024-01-01T00:00:01Z",
  request_headers: { "content-type": "application/json" },
  request_body: '{"test":true}',
  response_status: 200,
  response_headers: { "x-request-id": "abc" },
  response_body: '{"ok":true}',
  error_kind: null,
  error_message: null,
};

const validEventSummary = {
  id: "evt_123",
  endpoint_id: "ep_456",
  replayed_from_event_id: null,
  provider: "stripe",
  status: "pending" as const,
  attempts: 0,
  received_at: "2024-01-01T00:00:00Z",
  next_attempt_at: null,
  last_error: null,
};

const validEventListItem = {
  event: validEventSummary,
  target_url: "https://example.com/webhook",
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
      replayed_from_event_id: "evt_999",
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

describe("WebhookAttemptErrorKindSchema", () => {
  it("accepts valid error kinds", () => {
    const kinds = ["timeout", "network", "invalid_response", "unexpected"];
    for (const kind of kinds) {
      const result = Schema.decodeUnknownEither(WebhookAttemptErrorKindSchema)(kind);
      expect(Either.isRight(result)).toBe(true);
    }
  });

  it("rejects invalid error kind", () => {
    const result = Schema.decodeUnknownEither(WebhookAttemptErrorKindSchema)("invalid");
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("WebhookAttemptLogSchema", () => {
  it("accepts valid attempt log", () => {
    const result = Schema.decodeUnknownEither(WebhookAttemptLogSchema)(validAttemptLog);
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts attempt log with nullable fields as null", () => {
    const attemptWithNulls = {
      ...validAttemptLog,
      response_status: null,
      response_headers: null,
      response_body: null,
      error_kind: null,
      error_message: null,
    };
    const result = Schema.decodeUnknownEither(WebhookAttemptLogSchema)(attemptWithNulls);
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts attempt log with error fields populated", () => {
    const attemptWithError = {
      ...validAttemptLog,
      response_status: null,
      response_headers: null,
      response_body: null,
      error_kind: "timeout",
      error_message: "Request timed out",
    };
    const result = Schema.decodeUnknownEither(WebhookAttemptLogSchema)(attemptWithError);
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects invalid error_kind", () => {
    const result = Schema.decodeUnknownEither(WebhookAttemptLogSchema)({
      ...validAttemptLog,
      error_kind: "invalid_kind",
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("ListAttemptsResponseSchema", () => {
  it("accepts empty attempts array", () => {
    const result = Schema.decodeUnknownEither(ListAttemptsResponseSchema)({ attempts: [] });
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts valid attempts array", () => {
    const result = Schema.decodeUnknownEither(ListAttemptsResponseSchema)({
      attempts: [validAttemptLog],
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects missing attempts key", () => {
    const result = Schema.decodeUnknownEither(ListAttemptsResponseSchema)({});
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("WebhookEventSummarySchema", () => {
  it("accepts valid event summary", () => {
    const result = Schema.decodeUnknownEither(WebhookEventSummarySchema)(validEventSummary);
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts event summary with nullable fields populated", () => {
    const fullSummary = {
      ...validEventSummary,
      replayed_from_event_id: "evt_999",
      next_attempt_at: "2024-01-01T00:01:00Z",
      last_error: "Connection timeout",
    };
    const result = Schema.decodeUnknownEither(WebhookEventSummarySchema)(fullSummary);
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = Schema.decodeUnknownEither(WebhookEventSummarySchema)({
      ...validEventSummary,
      status: "unknown",
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("WebhookEventListItemSchema", () => {
  it("accepts valid event list item without circuit", () => {
    const result = Schema.decodeUnknownEither(WebhookEventListItemSchema)(validEventListItem);
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts event list item with circuit", () => {
    const withCircuit = { ...validEventListItem, circuit: validCircuit };
    const result = Schema.decodeUnknownEither(WebhookEventListItemSchema)(withCircuit);
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects invalid circuit shape", () => {
    const result = Schema.decodeUnknownEither(WebhookEventListItemSchema)({
      ...validEventListItem,
      circuit: { invalid: true },
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("ListEventsResponseSchema", () => {
  it("accepts empty events array", () => {
    const result = Schema.decodeUnknownEither(ListEventsResponseSchema)({
      events: [],
      next_before: null,
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts valid events array", () => {
    const result = Schema.decodeUnknownEither(ListEventsResponseSchema)({
      events: [validEventListItem],
      next_before: null,
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts next_before as string", () => {
    const result = Schema.decodeUnknownEither(ListEventsResponseSchema)({
      events: [validEventListItem],
      next_before: "2024-01-01T00:00:00Z",
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects missing events key", () => {
    const result = Schema.decodeUnknownEither(ListEventsResponseSchema)({
      next_before: null,
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("GetEventResponseSchema", () => {
  it("accepts valid response", () => {
    const result = Schema.decodeUnknownEither(GetEventResponseSchema)({
      event: validWebhookEvent,
      target_url: "https://example.com/webhook",
      circuit: null,
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts response with circuit", () => {
    const result = Schema.decodeUnknownEither(GetEventResponseSchema)({
      event: validWebhookEvent,
      target_url: "https://example.com/webhook",
      circuit: validCircuit,
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects missing event", () => {
    const result = Schema.decodeUnknownEither(GetEventResponseSchema)({
      target_url: "https://example.com/webhook",
      circuit: null,
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("ReplayEventResponseSchema", () => {
  it("accepts valid response", () => {
    const result = Schema.decodeUnknownEither(ReplayEventResponseSchema)({
      event: validEventSummary,
      circuit: null,
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts response with circuit", () => {
    const result = Schema.decodeUnknownEither(ReplayEventResponseSchema)({
      event: validEventSummary,
      circuit: validCircuit,
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects missing event", () => {
    const result = Schema.decodeUnknownEither(ReplayEventResponseSchema)({
      circuit: null,
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("ApiErrorCodeSchema", () => {
  it("accepts all valid error codes", () => {
    const codes = [
      "validation",
      "unauthorized",
      "rate_limited",
      "not_found",
      "conflict",
      "database",
      "internal",
    ];
    for (const code of codes) {
      const result = Schema.decodeUnknownEither(ApiErrorCodeSchema)(code);
      expect(Either.isRight(result)).toBe(true);
    }
  });

  it("rejects invalid error code", () => {
    const result = Schema.decodeUnknownEither(ApiErrorCodeSchema)("unknown");
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("ApiErrorResponseSchema", () => {
  it("accepts valid error response", () => {
    const result = Schema.decodeUnknownEither(ApiErrorResponseSchema)({
      code: "validation",
      message: "Invalid input",
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts all error codes in response", () => {
    const codes = [
      "validation",
      "unauthorized",
      "rate_limited",
      "not_found",
      "conflict",
      "database",
      "internal",
    ];
    for (const code of codes) {
      const result = Schema.decodeUnknownEither(ApiErrorResponseSchema)({
        code,
        message: "Error occurred",
      });
      expect(Either.isRight(result)).toBe(true);
    }
  });

  it("rejects missing code", () => {
    const result = Schema.decodeUnknownEither(ApiErrorResponseSchema)({
      message: "Error occurred",
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects missing message", () => {
    const result = Schema.decodeUnknownEither(ApiErrorResponseSchema)({
      code: "validation",
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects invalid code literal (fail-fast)", () => {
    const result = Schema.decodeUnknownEither(ApiErrorResponseSchema)({
      code: "invalid_code",
      message: "Error occurred",
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects non-string message", () => {
    const result = Schema.decodeUnknownEither(ApiErrorResponseSchema)({
      code: "validation",
      message: 123,
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});
