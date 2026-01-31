import { Data } from "effect";
import type { ApiErrorResponse } from "@repo/api";

export class ApiError extends Data.TaggedError("ApiError")<{
  readonly apiError: ApiErrorResponse;
}> {}

export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ParseError extends Data.TaggedError("ParseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type CoreError = ApiError | NetworkError | ParseError;

export const isTransientApiError = (err: ApiError): boolean =>
  err.apiError.code === "rate_limited" ||
  err.apiError.code === "database" ||
  err.apiError.code === "internal";
