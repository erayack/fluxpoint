import { Schema } from "effect";

export const WebhookAttemptErrorKindSchema = Schema.Literal(
  "timeout",
  "network",
  "invalid_response",
  "unexpected",
);

export const WebhookAttemptLogSchema = Schema.Struct({
  id: Schema.String,
  event_id: Schema.String,
  attempt_no: Schema.Number,
  started_at: Schema.String,
  finished_at: Schema.String,
  request_headers: Schema.Record({ key: Schema.String, value: Schema.String }),
  request_body: Schema.String,
  response_status: Schema.NullOr(Schema.Number),
  response_headers: Schema.NullOr(Schema.Record({ key: Schema.String, value: Schema.String })),
  response_body: Schema.NullOr(Schema.String),
  error_kind: Schema.NullOr(WebhookAttemptErrorKindSchema),
  error_message: Schema.NullOr(Schema.String),
});

export const ListAttemptsResponseSchema = Schema.Struct({
  attempts: Schema.Array(WebhookAttemptLogSchema),
});
