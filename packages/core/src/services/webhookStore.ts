import { Context, Effect, Layer, pipe } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpBody,
  type HttpClientError,
} from "@effect/platform";
import type { LeaseResponse, ReportRequest, ReportResponse } from "@repo/api";
import { ApiErrorResponseSchema, LeaseResponseSchema, ReportResponseSchema } from "@repo/api";
import { DispatcherConfig } from "./dispatcherConfig.js";
import { ApiError, NetworkError, ParseError, isTransientApiError } from "../errors/apiError.js";
import { transientApiRetrySchedule } from "../utils/retryPolicy.js";

const mapBodyError = (e: HttpBody.HttpBodyError) =>
  new ParseError({
    message: "Failed to serialize request body",
    cause: e,
  });

export interface WebhookStoreService {
  readonly lease: (
    limit: number,
    leaseMs: number,
  ) => Effect.Effect<LeaseResponse, ApiError | NetworkError | ParseError>;

  readonly report: (
    request: ReportRequest,
  ) => Effect.Effect<ReportResponse, ApiError | NetworkError | ParseError>;
}

export class WebhookStore extends Context.Tag("WebhookStore")<
  WebhookStore,
  WebhookStoreService
>() {}

export const WebhookStoreLive = Layer.effect(
  WebhookStore,
  Effect.gen(function* () {
    const config = yield* DispatcherConfig;
    const client = yield* HttpClient.HttpClient;

    const baseHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.internalApiToken) {
      baseHeaders["Authorization"] = `Bearer ${config.internalApiToken}`;
    }

    const withTransientRetry = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      pipe(
        effect,
        Effect.retry({
          while: (err): err is E => err instanceof ApiError && isTransientApiError(err),
          schedule: transientApiRetrySchedule,
        }),
      );

    const lease: WebhookStoreService["lease"] = (limit, leaseMs) => {
      const request = HttpClientRequest.post(
        `${config.internalApiBaseUrl}/internal/dispatcher/lease`,
      ).pipe(HttpClientRequest.setHeaders(baseHeaders));

      const httpCall = HttpClientRequest.bodyJson(request, {
        limit,
        lease_ms: leaseMs,
        worker_id: config.workerId,
      }).pipe(
        Effect.mapError(mapBodyError),
        Effect.flatMap((req) =>
          client.execute(req).pipe(
            Effect.mapError(
              (e: HttpClientError.HttpClientError) =>
                new NetworkError({
                  message: "Failed to reach Rust API for lease",
                  cause: e,
                }),
            ),
            Effect.flatMap((response) => {
              if (response.status >= 400) {
                return HttpClientResponse.schemaBodyJson(ApiErrorResponseSchema)(response).pipe(
                  Effect.mapError(
                    (e) =>
                      new ParseError({
                        message: "Invalid lease error response",
                        cause: e,
                      }),
                  ),
                  Effect.flatMap((apiError) => Effect.fail(new ApiError({ apiError }))),
                );
              }
              return HttpClientResponse.schemaBodyJson(LeaseResponseSchema)(response).pipe(
                Effect.map((body) => body as LeaseResponse),
                Effect.mapError(
                  (e) =>
                    new ParseError({
                      message: "Invalid lease response",
                      cause: e,
                    }),
                ),
              );
            }),
            Effect.scoped,
          ),
        ),
      );

      return withTransientRetry(httpCall);
    };

    const report: WebhookStoreService["report"] = (reportRequest) => {
      const request = HttpClientRequest.post(
        `${config.internalApiBaseUrl}/internal/dispatcher/report`,
      ).pipe(HttpClientRequest.setHeaders(baseHeaders));

      const httpCall = HttpClientRequest.bodyJson(request, reportRequest).pipe(
        Effect.mapError(mapBodyError),
        Effect.flatMap((req) =>
          client.execute(req).pipe(
            Effect.mapError(
              (e: HttpClientError.HttpClientError) =>
                new NetworkError({
                  message: "Failed to reach Rust API for report",
                  cause: e,
                }),
            ),
            Effect.flatMap((response) => {
              if (response.status >= 400) {
                return HttpClientResponse.schemaBodyJson(ApiErrorResponseSchema)(response).pipe(
                  Effect.mapError(
                    (e) =>
                      new ParseError({
                        message: "Invalid report error response",
                        cause: e,
                      }),
                  ),
                  Effect.flatMap((apiError) => Effect.fail(new ApiError({ apiError }))),
                );
              }
              return HttpClientResponse.schemaBodyJson(ReportResponseSchema)(response).pipe(
                Effect.map((body) => body as ReportResponse),
                Effect.mapError(
                  (e) =>
                    new ParseError({
                      message: "Invalid report response",
                      cause: e,
                    }),
                ),
              );
            }),
            Effect.scoped,
          ),
        ),
      );

      return withTransientRetry(httpCall);
    };

    return { lease, report };
  }),
);
