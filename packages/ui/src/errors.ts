import type { ApiErrorCode, ApiErrorResponse } from "@repo/api";

export class ApiClientError extends Error {
  readonly status: number;
  readonly apiError?: ApiErrorResponse;

  constructor(status: number, apiError?: ApiErrorResponse) {
    super(apiError?.message ?? "Request failed");
    this.name = "ApiClientError";
    this.status = status;
    this.apiError = apiError;
  }
}

const errorMessages: Record<ApiErrorCode, string> = {
  validation: "Please check your input and try again.",
  unauthorized: "You need to sign in to continue.",
  rate_limited: "Too many requests. Please wait a moment.",
  not_found: "The requested resource was not found.",
  conflict: "This action conflicts with existing data.",
  database: "A database error occurred. Please try again.",
  internal: "Something went wrong. Please try again later.",
};

export function isApiClientError(err: unknown): err is ApiClientError {
  return err instanceof ApiClientError;
}

export function getErrorMessage(err: unknown, label?: string): string {
  let msg: string;
  if (isApiClientError(err) && err.apiError) {
    msg = errorMessages[err.apiError.code] ?? err.apiError.message;
  } else if (err instanceof Error) {
    msg = err.message;
  } else {
    msg = "An unexpected error occurred.";
  }
  return label ? `${label}: ${msg}` : msg;
}
