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
  ) {}
}

interface UpstreamFailureMeta {
  path: string;
  status?: number;
  apiError?: ApiErrorResponse;
  rawBody?: string;
  reason: string;
}

const logUpstreamFailure = (meta: UpstreamFailureMeta) =>
  Effect.logError("Upstream request failed").pipe(
    Effect.annotateLogs({
      path: meta.path,
      reason: meta.reason,
      ...(meta.status !== undefined && { status: meta.status }),
      ...(meta.apiError && { code: meta.apiError.code, message: meta.apiError.message }),
      ...(dev && meta.rawBody && { rawBody: meta.rawBody }),
    }),
  );

const toProxyError = (apiError?: ApiErrorResponse) =>
  new ProxyError(502, "Upstream request failed", apiError);

export function requireDashboardKey(request: Request): Effect.Effect<void, Response> {
  return Effect.gen(function* () {
    const dashboardKey = env.FLUXPOINT_DASHBOARD_KEY;
    if (!dashboardKey) {
      return;
    }
    const provided = request.headers.get("x-fluxpoint-dashboard-key");
    if (provided !== dashboardKey) {
      yield* Effect.fail(json({ error: "Unauthorized" }, { status: 401 }));
    }
  });
}

export function createProxyFetch<A, I, R>(
  schema: Schema.Schema<A, I, R>,
  config: ProxyConfig,
): Effect.Effect<ProxyResult<A>, ProxyError, R> {
  return pipe(
    Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      (ctrl) => Effect.sync(() => ctrl.abort()),
    ),
    Effect.flatMap((abortController) =>
      Effect.gen(function* () {
        const baseUrl = env.FLUXPOINT_RUST_PUBLIC_API_BASE_URL;
        if (!baseUrl) {
          return yield* Effect.fail(new ProxyError(502, "Upstream not configured"));
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

        const fetchOptions: RequestInit = {
          method: config.method ?? "GET",
          headers,
          signal: abortController.signal,
        };

        if (config.body !== undefined) {
          headers["Content-Type"] = "application/json";
          fetchOptions.body = JSON.stringify(config.body);
        }

        const response = yield* Effect.tryPromise({
          try: () => fetch(url, fetchOptions),
          catch: () => toProxyError(),
        }).pipe(
          Effect.tapError(() => logUpstreamFailure({ path: config.path, reason: "network_error" })),
        );

        const rawText = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () => toProxyError(),
        }).pipe(
          Effect.tapError(() =>
            logUpstreamFailure({
              path: config.path,
              status: response.status,
              reason: "body_read_error",
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
              }),
              () => Effect.fail(toProxyError()),
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
            });
            yield* Effect.fail(toProxyError(apiError));
          } else {
            yield* logUpstreamFailure({
              path: config.path,
              status: response.status,
              reason: "invalid_upstream_error_format",
              rawBody: rawText,
            });
            yield* Effect.fail(toProxyError());
          }
        }

        const decoded = yield* Schema.decodeUnknown(schema)(parsed).pipe(
          Effect.tapError(() =>
            logUpstreamFailure({
              path: config.path,
              status: response.status,
              reason: "schema_validation_error",
              rawBody: rawText,
            }),
          ),
          Effect.mapError(() => toProxyError()),
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
          return Effect.succeed(json({ error: error.message }, { status: error.status }));
        }
        return Effect.succeed(json({ error: "Internal error" }, { status: 500 }));
      }),
    ),
  );
}
