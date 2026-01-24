import { Context, Data, Effect, Layer } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpBody,
  type HttpClientError,
} from "@effect/platform";
import type { LeaseResponse, ReportRequest, ReportResponse } from "@repo/api";
import { LeaseResponseSchema, ReportResponseSchema } from "@repo/api";
import { DispatcherConfig } from "./dispatcherConfig.js";

const mapBodyError = (e: HttpBody.HttpBodyError) =>
  new WebhookStoreError({
    reason: "ParseError",
    message: "Failed to serialize request body",
    cause: e,
  });

export class WebhookStoreError extends Data.TaggedError("WebhookStoreError")<{
  readonly reason: "NetworkError" | "ApiError" | "ParseError";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface WebhookStoreService {
  readonly lease: (
    limit: number,
    leaseMs: number,
  ) => Effect.Effect<LeaseResponse, WebhookStoreError>;

  readonly report: (request: ReportRequest) => Effect.Effect<ReportResponse, WebhookStoreError>;
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

    const lease: WebhookStoreService["lease"] = (limit, leaseMs) => {
      const request = HttpClientRequest.post(
        `${config.internalApiBaseUrl}/internal/dispatcher/lease`,
      ).pipe(HttpClientRequest.setHeaders(baseHeaders));

      return HttpClientRequest.bodyJson(request, {
        limit,
        lease_ms: leaseMs,
        worker_id: config.workerId,
      }).pipe(
        Effect.mapError(mapBodyError),
        Effect.flatMap((req) =>
          client.execute(req).pipe(
            Effect.mapError(
              (e: HttpClientError.HttpClientError) =>
                new WebhookStoreError({
                  reason: "NetworkError",
                  message: "Failed to reach Rust API for lease",
                  cause: e,
                }),
            ),
            Effect.flatMap((response) => {
              if (response.status >= 400) {
                return Effect.fail(
                  new WebhookStoreError({
                    reason: "ApiError",
                    message: `Lease request failed with status ${response.status}`,
                  }),
                );
              }
              return HttpClientResponse.schemaBodyJson(LeaseResponseSchema)(response).pipe(
                Effect.map((body) => body as LeaseResponse),
                Effect.mapError(
                  (e) =>
                    new WebhookStoreError({
                      reason: "ParseError",
                      message: "Invalid lease response",
                      cause: e,
                    }),
                ),
              );
            }),
            Effect.scoped,
          ),
        ),
      ) as Effect.Effect<LeaseResponse, WebhookStoreError>;
    };

    const report: WebhookStoreService["report"] = (reportRequest) => {
      const request = HttpClientRequest.post(
        `${config.internalApiBaseUrl}/internal/dispatcher/report`,
      ).pipe(HttpClientRequest.setHeaders(baseHeaders));

      return HttpClientRequest.bodyJson(request, reportRequest).pipe(
        Effect.mapError(mapBodyError),
        Effect.flatMap((req) =>
          client.execute(req).pipe(
            Effect.mapError(
              (e: HttpClientError.HttpClientError) =>
                new WebhookStoreError({
                  reason: "NetworkError",
                  message: "Failed to reach Rust API for report",
                  cause: e,
                }),
            ),
            Effect.flatMap((response) => {
              if (response.status >= 400) {
                return Effect.fail(
                  new WebhookStoreError({
                    reason: "ApiError",
                    message: `Report request failed with status ${response.status}`,
                  }),
                );
              }
              return HttpClientResponse.schemaBodyJson(ReportResponseSchema)(response).pipe(
                Effect.map((body) => body as ReportResponse),
                Effect.mapError(
                  (e) =>
                    new WebhookStoreError({
                      reason: "ParseError",
                      message: "Invalid report response",
                      cause: e,
                    }),
                ),
              );
            }),
            Effect.scoped,
          ),
        ),
      ) as Effect.Effect<ReportResponse, WebhookStoreError>;
    };

    return { lease, report };
  }),
);
