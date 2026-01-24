import { Duration, Effect, Exit, Fiber, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import * as TestClock from "effect/TestClock";
import * as TestContext from "effect/TestContext";
import type { LeasedEvent, ReportRequest, ReportResponse } from "@repo/api";

import type { DispatcherConfigService } from "../services/dispatcherConfig.js";
import { DispatcherConfig } from "../services/dispatcherConfig.js";
import {
  WebhookStore,
  WebhookStoreError,
  type WebhookStoreService,
} from "../services/webhookStore.js";
import { runDispatcherOnce } from "./dispatcher.js";

const baseConfig: DispatcherConfigService = {
  workerId: "worker-1",
  internalApiBaseUrl: "https://internal.example.test",
  internalApiToken: undefined,
  pollIntervalMs: 5000,
  batchSize: 1,
  concurrency: 1,
  leaseMs: 30000,
  requestTimeoutMs: 1000,
  immediateRetryMax: 0,
  maxAttempts: 3,
};

const makeLeasedEvent = (options?: { attempts?: number; id?: string }): LeasedEvent => ({
  event: {
    id: options?.id ?? "event-1",
    endpoint_id: "endpoint-1",
    provider: "test",
    headers: { "content-type": "application/json" },
    payload: "{\"ok\":true}",
    status: "pending",
    attempts: options?.attempts ?? 0,
    received_at: "2024-01-01T00:00:00Z",
    next_attempt_at: null,
    lease_expires_at: null,
    leased_by: null,
    last_error: null,
  },
  target_url: "https://example.test/webhook",
  lease_expires_at: "2024-01-01T00:00:30Z",
  circuit: null,
});

const makeResponse = (
  req: HttpClientRequest.HttpClientRequest,
  status: number,
): HttpClientResponse.HttpClientResponse =>
  HttpClientResponse.fromWeb(
    req,
    new Response("ok", {
      status,
      headers: { "Content-Type": "text/plain" },
    }),
  );

const makeClient = (
  handler: (
    req: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>,
) =>
  ({
    execute: (req: HttpClientRequest.HttpClientRequest) => handler(req),
  }) as HttpClient.HttpClient;

const setup = (options: {
  events: readonly LeasedEvent[];
  client: HttpClient.HttpClient;
  config?: DispatcherConfigService;
  reportEffect?: (request: ReportRequest) => Effect.Effect<ReportResponse, WebhookStoreError>;
}) => {
  const reports: ReportRequest[] = [];
  const store: WebhookStoreService = {
    lease: () => Effect.succeed({ events: [...options.events] }),
    report: (request) => {
      reports.push(request);
      return options.reportEffect
        ? options.reportEffect(request)
        : Effect.succeed({ circuit: null });
    },
  };

  const layer = Layer.mergeAll(
    Layer.succeed(DispatcherConfig, options.config ?? baseConfig),
    Layer.succeed(WebhookStore, store),
    Layer.succeed(HttpClient.HttpClient, options.client),
  );

  return { layer, reports };
};

type TestLayer = Layer.Layer<DispatcherConfigService | WebhookStoreService | HttpClient.HttpClient>;

const runOnce = (layer: TestLayer) =>
  Effect.runPromise(Effect.provide(runDispatcherOnce, layer));

const runOnceExit = (layer: TestLayer) =>
  Effect.runPromiseExit(Effect.provide(runDispatcherOnce, layer));

const runOnceWithTestClock = (
  layer: TestLayer,
  advanceStepsMs: number[],
  yieldsBetweenSteps = 1,
) =>
  Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(runDispatcherOnce);
        for (const step of advanceStepsMs) {
          for (let i = 0; i < yieldsBetweenSteps; i++) {
            yield* Effect.yieldNow();
          }
          yield* TestClock.adjust(Duration.millis(step));
        }
        return yield* Fiber.join(fiber);
      }),
      Layer.mergeAll(layer, TestContext.TestContext),
    ),
  );

describe("runDispatcherOnce", () => {
  it.each([
    { status: 200, outcome: "delivered", retryable: false },
    { status: 500, outcome: "retry", retryable: true },
    { status: 408, outcome: "retry", retryable: true },
    { status: 429, outcome: "retry", retryable: true },
    { status: 404, outcome: "dead", retryable: false },
  ])("reports outcome for status $status", async ({ status, outcome, retryable }) => {
    const client = makeClient((req) => Effect.succeed(makeResponse(req, status)));
    const { layer, reports } = setup({ events: [makeLeasedEvent()], client });

    await runOnce(layer);

    expect(reports).toHaveLength(1);
    const report = reports[0];
    expect(report.outcome).toBe(outcome);
    expect(report.retryable).toBe(retryable);
    expect(report.attempt.response_status).toBe(status);
    expect(report.attempt.error_kind).toBeNull();
  });

  it("marks network errors as retryable when attempts remain", async () => {
    const client = makeClient((req) =>
      Effect.fail(new HttpClientError.RequestError({ request: req, reason: "Transport" })),
    );
    const { layer, reports } = setup({
      events: [makeLeasedEvent({ attempts: 0 })],
      client,
      config: { ...baseConfig, maxAttempts: 3, immediateRetryMax: 0 },
    });

    await runOnce(layer);

    expect(reports).toHaveLength(1);
    const report = reports[0];
    expect(report.outcome).toBe("retry");
    expect(report.retryable).toBe(true);
    expect(report.attempt.error_kind).toBe("network");
    expect(report.attempt.response_status).toBeNull();
  });

  it("marks network errors as dead when max attempts reached", async () => {
    const client = makeClient((req) =>
      Effect.fail(new HttpClientError.RequestError({ request: req, reason: "Transport" })),
    );
    const { layer, reports } = setup({
      events: [makeLeasedEvent({ attempts: 2 })],
      client,
      config: { ...baseConfig, maxAttempts: 3, immediateRetryMax: 0 },
    });

    await runOnce(layer);

    expect(reports).toHaveLength(1);
    const report = reports[0];
    expect(report.outcome).toBe("dead");
    expect(report.retryable).toBe(true);
    expect(report.attempt.error_kind).toBe("network");
    expect(report.attempt.response_status).toBeNull();
  });

  it("marks timeouts as retryable when attempts remain", async () => {
    const client = makeClient(() => Effect.never);
    const { layer, reports } = setup({
      events: [makeLeasedEvent({ attempts: 0 })],
      client,
      config: { ...baseConfig, maxAttempts: 3, immediateRetryMax: 0, requestTimeoutMs: 1000 },
    });

    await runOnceWithTestClock(layer, [1100]);

    expect(reports).toHaveLength(1);
    const report = reports[0];
    expect(report.outcome).toBe("retry");
    expect(report.retryable).toBe(true);
    expect(report.attempt.error_kind).toBe("timeout");
    expect(report.attempt.error_message).toBe("Request timed out");
  });

  it("marks timeouts as dead when max attempts reached", async () => {
    const client = makeClient(() => Effect.never);
    const { layer, reports } = setup({
      events: [makeLeasedEvent({ attempts: 2 })],
      client,
      config: { ...baseConfig, maxAttempts: 3, immediateRetryMax: 0, requestTimeoutMs: 1000 },
    });

    await runOnceWithTestClock(layer, [1100]);

    expect(reports).toHaveLength(1);
    const report = reports[0];
    expect(report.outcome).toBe("dead");
    expect(report.retryable).toBe(true);
    expect(report.attempt.error_kind).toBe("timeout");
    expect(report.attempt.error_message).toBe("Request timed out");
  });

  it("does not fail the poll cycle when reporting fails", async () => {
    const client = makeClient((req) => Effect.succeed(makeResponse(req, 200)));
    const reportError = new WebhookStoreError({
      reason: "ApiError",
      message: "report failed",
    });
    const { layer } = setup({
      events: [makeLeasedEvent()],
      client,
      reportEffect: () => Effect.fail(reportError),
    });

    const exit = await runOnceExit(layer);

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("retries immediately until success when immediateRetryMax allows", async () => {
    let executeCount = 0;
    const client = makeClient((req) =>
      Effect.sync(() => {
        executeCount += 1;
        const status = executeCount < 3 ? 500 : 200;
        return makeResponse(req, status);
      }),
    );
    const { layer, reports } = setup({
      events: [makeLeasedEvent()],
      client,
      config: { ...baseConfig, immediateRetryMax: 2, maxAttempts: 5 },
    });

    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(runDispatcherOnce);
          for (let i = 0; i < 20; i++) {
            yield* Effect.yieldNow();
          }
          yield* TestClock.adjust(Duration.seconds(1));
          for (let i = 0; i < 20; i++) {
            yield* Effect.yieldNow();
          }
          yield* TestClock.adjust(Duration.seconds(2));
          for (let i = 0; i < 20; i++) {
            yield* Effect.yieldNow();
          }
          yield* TestClock.adjust(Duration.seconds(4));
          for (let i = 0; i < 20; i++) {
            yield* Effect.yieldNow();
          }
          return yield* Fiber.join(fiber);
        }),
        Layer.mergeAll(layer, TestContext.TestContext),
      ),
    );

    expect(executeCount).toBe(3);
    expect(reports).toHaveLength(1);
    expect(reports[0].outcome).toBe("delivered");
  });
});
