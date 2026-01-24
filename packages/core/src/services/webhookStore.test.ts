import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import {
  Headers,
  HttpBody,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import type { ReportRequest } from "@repo/api";

import type { DispatcherConfigService } from "./dispatcherConfig.js";
import { DispatcherConfig } from "./dispatcherConfig.js";
import { WebhookStore, WebhookStoreError, WebhookStoreLive } from "./webhookStore.js";

const baseConfig: DispatcherConfigService = {
  workerId: "worker-1",
  internalApiBaseUrl: "https://internal.example.test",
  internalApiToken: undefined,
  pollIntervalMs: 5000,
  batchSize: 10,
  concurrency: 2,
  leaseMs: 30000,
  requestTimeoutMs: 10000,
  immediateRetryMax: 2,
  maxAttempts: 10,
};

const jsonResponse = (
  req: HttpClientRequest.HttpClientRequest,
  body: unknown,
  status = 200,
): HttpClientResponse.HttpClientResponse =>
  HttpClientResponse.fromWeb(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

const readJsonBody = (body: HttpBody.HttpBody): unknown => {
  if (body._tag !== "Uint8Array") {
    return undefined;
  }
  const text = new TextDecoder().decode(body.body);
  return JSON.parse(text);
};

const getHeader = (headers: Headers.Headers, key: string): string | undefined =>
  Option.getOrUndefined(Headers.get(headers, key));

const runWithStore = <A>(
  config: DispatcherConfigService,
  client: HttpClient.HttpClient,
  effect: Effect.Effect<A, WebhookStoreError, WebhookStore>,
) => {
  const deps = Layer.mergeAll(
    Layer.succeed(DispatcherConfig, config),
    Layer.succeed(HttpClient.HttpClient, client),
  );
  const layer = Layer.provide(WebhookStoreLive, deps);
  return Effect.runPromise(Effect.provide(effect, layer));
};

const runWithStoreExit = <A>(
  config: DispatcherConfigService,
  client: HttpClient.HttpClient,
  effect: Effect.Effect<A, WebhookStoreError, WebhookStore>,
) => {
  const deps = Layer.mergeAll(
    Layer.succeed(DispatcherConfig, config),
    Layer.succeed(HttpClient.HttpClient, client),
  );
  const layer = Layer.provide(WebhookStoreLive, deps);
  return Effect.runPromiseExit(Effect.provide(effect, layer));
};

const leaseEffect = (limit: number, leaseMs: number) =>
  Effect.gen(function* () {
    const store = yield* WebhookStore;
    return yield* store.lease(limit, leaseMs);
  });

const reportEffect = (request: ReportRequest) =>
  Effect.gen(function* () {
    const store = yield* WebhookStore;
    return yield* store.report(request);
  });

const makeCapturingClient = (
  handler: (
    req: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>,
) => {
  let lastRequest: HttpClientRequest.HttpClientRequest | undefined;
  const client = {
    execute: (req: HttpClientRequest.HttpClientRequest) => {
      lastRequest = req;
      return handler(req);
    },
  } as HttpClient.HttpClient;

  return {
    client,
    getRequest: () => lastRequest,
  };
};

const getFailure = async (exit: Exit.Exit<unknown, WebhookStoreError>) => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) {
    return undefined;
  }

  return Option.getOrUndefined(Cause.failureOption(exit.cause));
};

describe("WebhookStoreLive", () => {
  it("leases with correct request shape and auth header when token is set", async () => {
    const { client, getRequest } = makeCapturingClient((req) =>
      Effect.succeed(jsonResponse(req, { events: [] })),
    );
    const config = { ...baseConfig, internalApiToken: "secret-token" };

    await runWithStore(config, client, leaseEffect(3, 45000));

    const request = getRequest();
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe(
      "https://internal.example.test/internal/dispatcher/lease",
    );

    const headers = request?.headers;
    expect(headers && getHeader(headers, "content-type")).toBe("application/json");
    expect(headers && getHeader(headers, "authorization")).toBe("Bearer secret-token");

    const body = request?.body ? readJsonBody(request.body) : undefined;
    expect(body).toEqual({ limit: 3, lease_ms: 45000, worker_id: "worker-1" });
  });

  it("omits authorization header when token is missing", async () => {
    const { client, getRequest } = makeCapturingClient((req) =>
      Effect.succeed(jsonResponse(req, { events: [] })),
    );

    await runWithStore(baseConfig, client, leaseEffect(1, 1000));

    const headers = getRequest()?.headers;
    expect(headers && getHeader(headers, "authorization")).toBeUndefined();
  });

  it("reports with request body unchanged and decodes response", async () => {
    const reportRequest: ReportRequest = {
      worker_id: "worker-1",
      event_id: "event-1",
      outcome: "delivered",
      retryable: false,
      next_attempt_at: null,
      attempt: {
        started_at: "2024-01-01T00:00:00Z",
        finished_at: "2024-01-01T00:00:01Z",
        request_headers: { "content-type": "application/json" },
        request_body: "{\"ok\":true}",
        response_status: 200,
        response_headers: { "content-type": "application/json" },
        response_body: "{\"ok\":true}",
        error_kind: null,
        error_message: null,
      },
    };

    const { client, getRequest } = makeCapturingClient((req) =>
      Effect.succeed(jsonResponse(req, { circuit: null })),
    );

    await runWithStore(baseConfig, client, reportEffect(reportRequest));

    const request = getRequest();
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe(
      "https://internal.example.test/internal/dispatcher/report",
    );

    const headers = request?.headers;
    expect(headers && getHeader(headers, "content-type")).toBe("application/json");

    const body = request?.body ? readJsonBody(request.body) : undefined;
    expect(body).toEqual(reportRequest);
  });

  it("maps lease network failures to WebhookStoreError", async () => {
    const { client } = makeCapturingClient((req) =>
      Effect.fail(new HttpClientError.RequestError({ request: req, reason: "Transport" })),
    );

    const exit = await runWithStoreExit(baseConfig, client, leaseEffect(2, 5000));
    const failure = await getFailure(exit);

    expect(failure).toBeInstanceOf(WebhookStoreError);
    expect(failure?.reason).toBe("NetworkError");
  });

  it("maps lease HTTP errors to WebhookStoreError", async () => {
    const { client } = makeCapturingClient((req) =>
      Effect.succeed(jsonResponse(req, { error: "nope" }, 500)),
    );

    const exit = await runWithStoreExit(baseConfig, client, leaseEffect(2, 5000));
    const failure = await getFailure(exit);

    expect(failure).toBeInstanceOf(WebhookStoreError);
    expect(failure?.reason).toBe("ApiError");
  });

  it("maps lease schema failures to WebhookStoreError", async () => {
    const { client } = makeCapturingClient((req) =>
      Effect.succeed(jsonResponse(req, { nope: true })),
    );

    const exit = await runWithStoreExit(baseConfig, client, leaseEffect(2, 5000));
    const failure = await getFailure(exit);

    expect(failure).toBeInstanceOf(WebhookStoreError);
    expect(failure?.reason).toBe("ParseError");
  });

  it("maps report network failures to WebhookStoreError", async () => {
    const { client } = makeCapturingClient((req) =>
      Effect.fail(new HttpClientError.RequestError({ request: req, reason: "Transport" })),
    );

    const reportRequest: ReportRequest = {
      worker_id: "worker-1",
      event_id: "event-2",
      outcome: "dead",
      retryable: false,
      next_attempt_at: null,
      attempt: {
        started_at: "2024-01-01T00:00:00Z",
        finished_at: "2024-01-01T00:00:02Z",
        request_headers: {},
        request_body: "{}",
        response_status: null,
        response_headers: null,
        response_body: null,
        error_kind: "network",
        error_message: "boom",
      },
    };

    const exit = await runWithStoreExit(baseConfig, client, reportEffect(reportRequest));
    const failure = await getFailure(exit);

    expect(failure).toBeInstanceOf(WebhookStoreError);
    expect(failure?.reason).toBe("NetworkError");
  });

  it("maps report HTTP errors to WebhookStoreError", async () => {
    const { client } = makeCapturingClient((req) =>
      Effect.succeed(jsonResponse(req, { error: "nope" }, 400)),
    );

    const reportRequest: ReportRequest = {
      worker_id: "worker-1",
      event_id: "event-3",
      outcome: "retry",
      retryable: true,
      next_attempt_at: null,
      attempt: {
        started_at: "2024-01-01T00:00:00Z",
        finished_at: "2024-01-01T00:00:02Z",
        request_headers: {},
        request_body: "{}",
        response_status: null,
        response_headers: null,
        response_body: null,
        error_kind: "unexpected",
        error_message: "nope",
      },
    };

    const exit = await runWithStoreExit(baseConfig, client, reportEffect(reportRequest));
    const failure = await getFailure(exit);

    expect(failure).toBeInstanceOf(WebhookStoreError);
    expect(failure?.reason).toBe("ApiError");
  });

  it("maps report schema failures to WebhookStoreError", async () => {
    const { client } = makeCapturingClient((req) =>
      Effect.succeed(jsonResponse(req, { nope: true })),
    );

    const reportRequest: ReportRequest = {
      worker_id: "worker-1",
      event_id: "event-4",
      outcome: "delivered",
      retryable: false,
      next_attempt_at: null,
      attempt: {
        started_at: "2024-01-01T00:00:00Z",
        finished_at: "2024-01-01T00:00:02Z",
        request_headers: {},
        request_body: "{}",
        response_status: 200,
        response_headers: {},
        response_body: "{}",
        error_kind: null,
        error_message: null,
      },
    };

    const exit = await runWithStoreExit(baseConfig, client, reportEffect(reportRequest));
    const failure = await getFailure(exit);

    expect(failure).toBeInstanceOf(WebhookStoreError);
    expect(failure?.reason).toBe("ParseError");
  });

  it("maps report serialization failures to WebhookStoreError", async () => {
    const { client } = makeCapturingClient((req) =>
      Effect.succeed(jsonResponse(req, { circuit: null })),
    );

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const exit = await runWithStoreExit(
      baseConfig,
      client,
      reportEffect(circular as unknown as ReportRequest),
    );
    const failure = await getFailure(exit);

    expect(failure).toBeInstanceOf(WebhookStoreError);
    expect(failure?.reason).toBe("ParseError");
    expect(failure?.message).toBe("Failed to serialize request body");
  });
});
