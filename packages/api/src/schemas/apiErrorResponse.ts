import { Schema } from "effect";

export const ApiErrorCodeSchema = Schema.Literal(
  "validation",
  "unauthorized",
  "rate_limited",
  "not_found",
  "conflict",
  "database",
  "internal",
);

export const ApiErrorResponseSchema = Schema.Struct({
  code: ApiErrorCodeSchema,
  message: Schema.String,
});

export type ApiErrorCode = Schema.Schema.Type<typeof ApiErrorCodeSchema>;
export type ApiErrorResponse = Schema.Schema.Type<typeof ApiErrorResponseSchema>;
