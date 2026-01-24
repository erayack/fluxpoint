import { Schema } from "effect";

export const WebhookEventStatusSchema = Schema.Literal(
  "pending",
  "in_flight",
  "requeued",
  "delivered",
  "dead",
  "paused",
);

export const TargetCircuitStatusSchema = Schema.Literal("closed", "open");

export const TargetCircuitStateSchema = Schema.Struct({
  endpoint_id: Schema.String,
  state: TargetCircuitStatusSchema,
  open_until: Schema.NullOr(Schema.String),
  consecutive_failures: Schema.Number,
  last_failure_at: Schema.NullOr(Schema.String),
});

export const WebhookEventSchema = Schema.Struct({
  id: Schema.String,
  endpoint_id: Schema.String,
  provider: Schema.String,
  headers: Schema.Record({ key: Schema.String, value: Schema.String }),
  payload: Schema.String,
  status: WebhookEventStatusSchema,
  attempts: Schema.Number,
  received_at: Schema.String,
  next_attempt_at: Schema.NullOr(Schema.String),
  lease_expires_at: Schema.NullOr(Schema.String),
  leased_by: Schema.NullOr(Schema.String),
  last_error: Schema.NullOr(Schema.String),
});

export const LeasedEventSchema = Schema.Struct({
  event: WebhookEventSchema,
  target_url: Schema.String,
  lease_expires_at: Schema.String,
  circuit: Schema.NullOr(TargetCircuitStateSchema),
});

export const LeaseResponseSchema = Schema.Struct({
  events: Schema.Array(LeasedEventSchema),
});
