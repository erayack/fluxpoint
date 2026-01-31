import { Schema } from "effect";
import { TargetCircuitStateSchema, WebhookEventStatusSchema } from "./leaseResponse.js";

export const WebhookEventSummarySchema = Schema.Struct({
  id: Schema.String,
  endpoint_id: Schema.String,
  replayed_from_event_id: Schema.NullOr(Schema.String),
  provider: Schema.String,
  status: WebhookEventStatusSchema,
  attempts: Schema.Number,
  received_at: Schema.String,
  next_attempt_at: Schema.NullOr(Schema.String),
  last_error: Schema.NullOr(Schema.String),
});

export const WebhookEventListItemSchema = Schema.Struct({
  event: WebhookEventSummarySchema,
  target_url: Schema.String,
  circuit: Schema.NullOr(TargetCircuitStateSchema),
});

export const ListEventsResponseSchema = Schema.Struct({
  events: Schema.Array(WebhookEventListItemSchema),
  next_before: Schema.NullOr(Schema.String),
});
