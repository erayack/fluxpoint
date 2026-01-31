import { Effect, Schema, pipe } from "effect";
import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { dev } from "$app/environment";
import { ApiErrorResponseSchema, type ApiErrorResponse } from "@repo/api";

export interface ProxyConfig {
  path: string;
  method?: "GET" | "POST";
  query?: URLSearchParams;
  body?: unknown;
  signal?: AbortSignal;
  requestId?: string;
}

export interface ProxyResult<T> {
  data: T;
  status: number;
}

export class ProxyError {
  readonly _tag = "ProxyError";
  constructor(
    readonly status: number,
    readonly message: string,
    readonly apiError?: ApiErrorResponse,
    readonly isAbort = false,
  ) {}
}

interface UpstreamFailureMeta {
  path: string;
  status?: number;
  apiError?: ApiErrorResponse;
  rawBody?: string;
  reason: string;
  requestId?: string;
}

const logUpstreamFailure = (meta: UpstreamFailureMeta) =>
  Effect.logError("Upstream request failed").pipe(
    Effect.annotateLogs({
      path: meta.path,
      reason: meta.reason,
      ...(meta.requestId && { requestId: meta.requestId }),
      ...(meta.status !== undefined && { status: meta.status }),
      ...(meta.apiError && { code: meta.apiError.code, message: meta.apiError.message }),
      ...(dev && meta.rawBody && { rawBody: meta.rawBody }),
    }),
  );

const logUpstreamCancellation = (meta: UpstreamFailureMeta) =>
  Effect.logInfo("Upstream request canceled").pipe(
    Effect.annotateLogs({
      path: meta.path,
      reason: meta.reason,
      ...(meta.requestId && { requestId: meta.requestId }),
    }),
  );

const buildInternalError = (message: string): ApiErrorResponse => ({
  code: "internal",
  message,
});

const isAbortError = (error: unknown) => error instanceof Error && error.name === "AbortError";

export function requireDashboardKey(request: Request): Effect.Effect<void, Response> {
  return Effect.gen(function* () {
    const dashboardKey = env.FLUXPOINT_DASHBOARD_KEY;
    if (!dashboardKey) {
      return;
    }
    const provided = request.headers.get("x-fluxpoint-dashboard-key");
    if (provided !== dashboardKey) {
      yield* Effect.fail(json({ code: "unauthorized", message: "Unauthorized" }, { status: 401 }));
    }
  });
}

export function createProxyFetch<A, I, R>(
  schema: Schema.Schema<A, I, R>,
  config: ProxyConfig,
): Effect.Effect<ProxyResult<A>, ProxyError, R> {
  return pipe(
    Effect.acquireRelease(
      Effect.sync(() => {
        const controller = new AbortController();
        if (!config.signal) {
          return { controller, cleanup: undefined };
        }
        const handleAbort = () => controller.abort();
        if (config.signal.aborted) {
          controller.abort();
        } else {
          config.signal.addEventListener("abort", handleAbort, { once: true });
        }
        return {
          controller,
          cleanup: () => config.signal?.removeEventListener("abort", handleAbort),
        };
      }),
      ({ controller, cleanup }) =>
        Effect.sync(() => {
          cleanup?.();
          controller.abort();
        }),
    ),
    Effect.flatMap(({ controller }) =>
      Effect.gen(function* () {
        const baseUrl = env.FLUXPOINT_RUST_PUBLIC_API_BASE_URL;
        if (!baseUrl) {
          return yield* Effect.fail(
            new ProxyError(
              503,
              "Upstream not configured",
              buildInternalError("Upstream not configured"),
            ),
          );
        }

        let url = `${baseUrl}${config.path}`;
        if (config.query && config.query.toString()) {
          url += `?${config.query.toString()}`;
        }

        const headers: Record<string, string> = {
          Accept: "application/json",
        };

        const token = env.FLUXPOINT_RUST_PUBLIC_API_TOKEN;
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
        if (config.requestId) {
          headers["x-request-id"] = config.requestId;
        }

        const fetchOptions: RequestInit = {
          method: config.method ?? "GET",
          headers,
          signal: controller.signal,
        };

        if (config.body !== undefined) {
          headers["Content-Type"] = "application/json";
          fetchOptions.body = JSON.stringify(config.body);
        }

        const response = yield* Effect.tryPromise({
          try: () => fetch(url, fetchOptions),
          catch: (error) =>
            isAbortError(error)
              ? new ProxyError(
                  499,
                  "Request canceled",
                  buildInternalError("Request canceled"),
                  true,
                )
              : new ProxyError(
                  503,
                  "Upstream unreachable",
                  buildInternalError("Upstream unreachable"),
                ),
        }).pipe(
          Effect.tapError((error) => {
            if (error instanceof ProxyError && error.isAbort) {
              return logUpstreamCancellation({
                path: config.path,
                reason: "request_canceled",
                requestId: config.requestId,
              });
            }
            return logUpstreamFailure({
              path: config.path,
              reason: "network_error",
              requestId: config.requestId,
            });
          }),
        );

        const rawText = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () =>
            new ProxyError(
              502,
              "Invalid upstream response",
              buildInternalError("Invalid upstream response"),
            ),
        }).pipe(
          Effect.tapError(() =>
            logUpstreamFailure({
              path: config.path,
              status: response.status,
              reason: "body_read_error",
              requestId: config.requestId,
            }),
          ),
        );

        const parseResult = Effect.try({
          try: () => JSON.parse(rawText) as unknown,
          catch: () => new Error("parse_error"),
        });

        const parsed = yield* parseResult.pipe(
          Effect.catchAll(() =>
            Effect.flatMap(
              logUpstreamFailure({
                path: config.path,
                status: response.status,
                reason: "json_parse_error",
                rawBody: rawText,
                requestId: config.requestId,
              }),
              () =>
                Effect.fail(
                  new ProxyError(
                    502,
                    "Invalid upstream response",
                    buildInternalError("Invalid upstream response"),
                  ),
                ),
            ),
          ),
        );

        if (!response.ok) {
          const apiErrorResult = Schema.decodeUnknownEither(ApiErrorResponseSchema)(parsed);
          if (apiErrorResult._tag === "Right") {
            const apiError = apiErrorResult.right;
            yield* logUpstreamFailure({
              path: config.path,
              status: response.status,
              apiError,
              reason: "upstream_error",
              requestId: config.requestId,
            });
            yield* Effect.fail(new ProxyError(response.status, apiError.message, apiError));
          } else {
            yield* logUpstreamFailure({
              path: config.path,
              status: response.status,
              reason: "invalid_upstream_error_format",
              rawBody: rawText,
              requestId: config.requestId,
            });
            yield* Effect.fail(
              new ProxyError(
                502,
                "Invalid upstream response",
                buildInternalError("Invalid upstream response"),
              ),
            );
          }
        }

        const decoded = yield* Schema.decodeUnknown(schema)(parsed).pipe(
          Effect.tapError(() =>
            logUpstreamFailure({
              path: config.path,
              status: response.status,
              reason: "schema_validation_error",
              rawBody: rawText,
              requestId: config.requestId,
            }),
          ),
          Effect.mapError(
            () =>
              new ProxyError(
                502,
                "Invalid upstream response",
                buildInternalError("Invalid upstream response"),
              ),
          ),
        );

        return { data: decoded, status: response.status };
      }),
    ),
    Effect.scoped,
  );
}

export function runProxy<A>(
  effect: Effect.Effect<ProxyResult<A>, ProxyError | Response>,
): Promise<Response> {
  return Effect.runPromise(
    effect.pipe(
      Effect.map(({ data, status }) => json(data, { status })),
      Effect.catchAll((error) => {
        if (error instanceof Response) {
          return Effect.succeed(error);
        }
        if (error instanceof ProxyError) {
          const apiError = error.apiError ?? buildInternalError(error.message);
          return Effect.succeed(json(apiError, { status: error.status }));
        }
        return Effect.succeed(json(buildInternalError("Internal error"), { status: 500 }));
      }),
    ),
  );
}
