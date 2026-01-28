import { Duration, Effect, Fiber, Layer } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse, delay } from "msw";
import { setupServer } from "msw/node";
import { FetchHttpClient } from "@effect/platform";
import * as TestClock from "effect/TestClock";
import * as TestContext from "effect/TestContext";
import type { LeasedEvent, ReportRequest } from "@repo/api";

import type { DispatcherConfigService } from "../services/dispatcherConfig.js";
import { DispatcherConfig } from "../services/dispatcherConfig.js";
import { WebhookStoreLive } from "../services/webhookStore.js";
import { runDispatcherOnce } from "./dispatcher.js";

const BASE_URL = "https://internal.example.test";
const TARGET_URL = "https://target.example.test/webhook";

const baseConfig: DispatcherConfigService = {
  workerId: "integration-worker",
  internalApiBaseUrl: BASE_URL,
  internalApiToken: undefined,
  pollIntervalMs: 100,
  batchSize: 1,
  concurrency: 1,
  leaseMs: 30000,
  requestTimeoutMs: 500,
  immediateRetryMax: 0,
  maxAttempts: 3,
};

const makeLeasedEvent = (options?: {
  attempts?: number;
  id?: string;
  targetUrl?: string;
}): LeasedEvent => ({
  event: {
    id: options?.id ?? "event-1",
    endpoint_id: "endpoint-1",
    provider: "test",
    headers: { "content-type": "application/json" },
    payload: '{"ok":true}',
    status: "pending",
    attempts: options?.attempts ?? 0,
    received_at: "2024-01-01T00:00:00Z",
    next_attempt_at: null,
    lease_expires_at: null,
    leased_by: null,
    last_error: null,
  },
  target_url: options?.targetUrl ?? TARGET_URL,
  lease_expires_at: "2024-01-01T00:00:30Z",
  circuit: null,
});

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const makeIntegrationLayer = (config: Partial<DispatcherConfigService> = {}) => {
  const configLayer = Layer.succeed(DispatcherConfig, { ...baseConfig, ...config });
  const httpLayer = FetchHttpClient.layer;
  const storeLayer = Layer.provide(WebhookStoreLive, Layer.merge(configLayer, httpLayer));
  return Layer.mergeAll(configLayer, httpLayer, storeLayer);
};

const runOnce = (config: Partial<DispatcherConfigService> = {}) =>
  Effect.runPromise(Effect.provide(runDispatcherOnce, makeIntegrationLayer(config)));

const runOnceWithTestClock = (
  config: Partial<DispatcherConfigService>,
  advanceStepsMs: number[],
  yieldsBetweenSteps = 5,
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
      Layer.mergeAll(makeIntegrationLayer(config), TestContext.TestContext),
    ),
  );

describe("dispatcher integration", () => {
  describe("end-to-end delivery flow", () => {
    it("delivers webhook and reports outcome to internal API", async () => {
      const capturedTargetRequests: Request[] = [];
      const capturedReports: ReportRequest[] = [];

      server.use(
        http.post(`${BASE_URL}/internal/dispatcher/lease`, () =>
          HttpResponse.json({ events: [makeLeasedEvent()] }),
        ),
        http.post(TARGET_URL, async ({ request }) => {
          capturedTargetRequests.push(request.clone());
          return HttpResponse.text("OK", { status: 200 });
        }),
        http.post(`${BASE_URL}/internal/dispatcher/report`, async ({ request }) => {
          capturedReports.push((await request.json()) as ReportRequest);
          return HttpResponse.json({ circuit: null });
        }),
      );

      await runOnce();

      expect(capturedTargetRequests).toHaveLength(1);
      expect(capturedReports).toHaveLength(1);
      expect(capturedReports[0].outcome).toBe("delivered");
      expect(capturedReports[0].event_id).toBe("event-1");
    });

    it("forwards request headers and body to target", async () => {
      let capturedBody: unknown = null;
      let capturedContentType: string | null = null;

      server.use(
        http.post(`${BASE_URL}/internal/dispatcher/lease`, () =>
          HttpResponse.json({ events: [makeLeasedEvent()] }),
        ),
        http.post(TARGET_URL, async ({ request }) => {
          capturedContentType = request.headers.get("content-type");
          capturedBody = await request.json();
          return HttpResponse.text("OK", { status: 200 });
        }),
        http.post(`${BASE_URL}/internal/dispatcher/report`, () =>
          HttpResponse.json({ circuit: null }),
        ),
      );

      await runOnce();

      expect(capturedContentType).toBe("application/json");
      expect(capturedBody).toEqual({ ok: true });
    });

    it("handles empty lease response gracefully", async () => {
      let leaseCallCount = 0;

      server.use(
        http.post(`${BASE_URL}/internal/dispatcher/lease`, () => {
          leaseCallCount++;
          return HttpResponse.json({ events: [] });
        }),
      );

      await runOnce();

      expect(leaseCallCount).toBe(1);
    });
  });

  describe("status code classification", () => {
    it.each([
      { status: 200, expectedOutcome: "delivered" },
      { status: 201, expectedOutcome: "delivered" },
      { status: 204, expectedOutcome: "delivered" },
      { status: 400, expectedOutcome: "dead" },
      { status: 404, expectedOutcome: "dead" },
      { status: 500, expectedOutcome: "retry" },
      { status: 502, expectedOutcome: "retry" },
      { status: 503, expectedOutcome: "retry" },
      { status: 408, expectedOutcome: "retry" },
      { status: 429, expectedOutcome: "retry" },
    ])("reports $expectedOutcome for HTTP $status", async ({ status, expectedOutcome }) => {
      const capturedReports: ReportRequest[] = [];

      server.use(
        http.post(`${BASE_URL}/internal/dispatcher/lease`, () =>
          HttpResponse.json({ events: [makeLeasedEvent()] }),
        ),
        http.post(TARGET_URL, () => HttpResponse.text("Error", { status })),
        http.post(`${BASE_URL}/internal/dispatcher/report`, async ({ request }) => {
          capturedReports.push((await request.json()) as ReportRequest);
          return HttpResponse.json({ circuit: null });
        }),
      );

      await runOnce();

      expect(capturedReports).toHaveLength(1);
      expect(capturedReports[0].outcome).toBe(expectedOutcome);
    });
  });

  describe("retry behavior", () => {
    it("retries on 500 and succeeds on subsequent attempt", async () => {
      let targetCallCount = 0;
      const capturedReports: ReportRequest[] = [];

      server.use(
        http.post(`${BASE_URL}/internal/dispatcher/lease`, () =>
          HttpResponse.json({ events: [makeLeasedEvent()] }),
        ),
        http.post(TARGET_URL, () => {
          targetCallCount++;
          if (targetCallCount < 3) {
            return HttpResponse.text("Server Error", { status: 500 });
          }
          return HttpResponse.text("OK", { status: 200 });
        }),
        http.post(`${BASE_URL}/internal/dispatcher/report`, async ({ request }) => {
          capturedReports.push((await request.json()) as ReportRequest);
          return HttpResponse.json({ circuit: null });
        }),
      );

      await runOnceWithTestClock({ immediateRetryMax: 2 }, [1100, 2100, 4100]);

      expect(targetCallCount).toBe(3);
      expect(capturedReports).toHaveLength(1);
      expect(capturedReports[0].outcome).toBe("delivered");
    });

    it("stops retrying after immediateRetryMax exhausted", async () => {
      let targetCallCount = 0;
      const capturedReports: ReportRequest[] = [];

      server.use(
        http.post(`${BASE_URL}/internal/dispatcher/lease`, () =>
          HttpResponse.json({ events: [makeLeasedEvent()] }),
        ),
        http.post(TARGET_URL, () => {
          targetCallCount++;
          return HttpResponse.text("Server Error", { status: 500 });
        }),
        http.post(`${BASE_URL}/internal/dispatcher/report`, async ({ request }) => {
          capturedReports.push((await request.json()) as ReportRequest);
          return HttpResponse.json({ circuit: null });
        }),
      );

      await runOnceWithTestClock({ immediateRetryMax: 2 }, [1100, 2100, 4100]);

      expect(targetCallCount).toBe(3);
      expect(capturedReports).toHaveLength(1);
      expect(capturedReports[0].outcome).toBe("retry");
      expect(capturedReports[0].retryable).toBe(true);
    });

    it("handles request timeout and marks as retryable", async () => {
      const capturedReports: ReportRequest[] = [];

      server.use(
        http.post(`${BASE_URL}/internal/dispatcher/lease`, () =>
          HttpResponse.json({ events: [makeLeasedEvent()] }),
        ),
        http.post(TARGET_URL, async () => {
          await delay(10000);
          return HttpResponse.text("OK", { status: 200 });
        }),
        http.post(`${BASE_URL}/internal/dispatcher/report`, async ({ request }) => {
          capturedReports.push((await request.json()) as ReportRequest);
          return HttpResponse.json({ circuit: null });
        }),
      );

      await runOnceWithTestClock({ requestTimeoutMs: 100, immediateRetryMax: 0 }, [200]);

      expect(capturedReports).toHaveLength(1);
      expect(capturedReports[0].outcome).toBe("retry");
      expect(capturedReports[0].retryable).toBe(true);
      expect(capturedReports[0].attempt.error_kind).toBe("timeout");
    });

    it("reports timeout as retry (Rust backend handles attempt limits)", async () => {
      const capturedReports: ReportRequest[] = [];

      server.use(
        http.post(`${BASE_URL}/internal/dispatcher/lease`, () =>
          HttpResponse.json({ events: [makeLeasedEvent({ attempts: 2 })] }),
        ),
        http.post(TARGET_URL, async () => {
          await delay(10000);
          return HttpResponse.text("OK", { status: 200 });
        }),
        http.post(`${BASE_URL}/internal/dispatcher/report`, async ({ request }) => {
          capturedReports.push((await request.json()) as ReportRequest);
          return HttpResponse.json({ circuit: null });
        }),
      );

      await runOnceWithTestClock(
        { requestTimeoutMs: 100, immediateRetryMax: 0, maxAttempts: 3 },
        [200],
      );

      expect(capturedReports).toHaveLength(1);
      expect(capturedReports[0].outcome).toBe("retry");
      expect(capturedReports[0].retryable).toBe(true);
    });
  });

  describe("batch processing", () => {
    it("processes multiple events in a batch", async () => {
      const capturedReports: ReportRequest[] = [];

      const events = [
        makeLeasedEvent({ id: "event-1" }),
        makeLeasedEvent({ id: "event-2" }),
        makeLeasedEvent({ id: "event-3" }),
      ];

      server.use(
        http.post(`${BASE_URL}/internal/dispatcher/lease`, () => HttpResponse.json({ events })),
        http.post(TARGET_URL, () => HttpResponse.text("OK", { status: 200 })),
        http.post(`${BASE_URL}/internal/dispatcher/report`, async ({ request }) => {
          capturedReports.push((await request.json()) as ReportRequest);
          return HttpResponse.json({ circuit: null });
        }),
      );

      await runOnce({ batchSize: 3 });

      expect(capturedReports).toHaveLength(3);
      const eventIds = capturedReports.map((r) => r.event_id).sort();
      expect(eventIds).toEqual(["event-1", "event-2", "event-3"]);
    });

    it("processes events concurrently based on concurrency config", async () => {
      const inFlightTimestamps: number[] = [];
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const events = [
        makeLeasedEvent({ id: "event-1" }),
        makeLeasedEvent({ id: "event-2" }),
        makeLeasedEvent({ id: "event-3" }),
      ];

      server.use(
        http.post(`${BASE_URL}/internal/dispatcher/lease`, () => HttpResponse.json({ events })),
        http.post(TARGET_URL, async () => {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);
          inFlightTimestamps.push(Date.now());
          await delay(50);
          concurrentCount--;
          return HttpResponse.text("OK", { status: 200 });
        }),
        http.post(`${BASE_URL}/internal/dispatcher/report`, () =>
          HttpResponse.json({ circuit: null }),
        ),
      );

      await runOnce({ batchSize: 3, concurrency: 3 });

      expect(maxConcurrent).toBeGreaterThanOrEqual(2);
    });
  });

  describe("internal API communication", () => {
    it("sends correct lease request payload", async () => {
      let capturedLeaseBody: unknown = null;

      server.use(
        http.post(`${BASE_URL}/internal/dispatcher/lease`, async ({ request }) => {
          capturedLeaseBody = await request.json();
          return HttpResponse.json({ events: [] });
        }),
      );

      await runOnce({ batchSize: 5, leaseMs: 60000 });

      expect(capturedLeaseBody).toEqual({
        limit: 5,
        lease_ms: 60000,
        worker_id: "integration-worker",
      });
    });

    it("sends correct report request payload", async () => {
      let capturedReportBody: ReportRequest | null = null;

      server.use(
        http.post(`${BASE_URL}/internal/dispatcher/lease`, () =>
          HttpResponse.json({ events: [makeLeasedEvent()] }),
        ),
        http.post(TARGET_URL, () => HttpResponse.text("OK", { status: 200 })),
        http.post(`${BASE_URL}/internal/dispatcher/report`, async ({ request }) => {
          capturedReportBody = (await request.json()) as ReportRequest;
          return HttpResponse.json({ circuit: null });
        }),
      );

      await runOnce();

      expect(capturedReportBody).not.toBeNull();
      expect(capturedReportBody!.worker_id).toBe("integration-worker");
      expect(capturedReportBody!.event_id).toBe("event-1");
      expect(capturedReportBody!.outcome).toBe("delivered");
      expect(capturedReportBody!.attempt.response_status).toBe(200);
      expect(capturedReportBody!.attempt.request_body).toBe('{"ok":true}');
    });

    it("includes authorization header when token configured", async () => {
      let capturedAuthHeader: string | null = null;

      server.use(
        http.post(`${BASE_URL}/internal/dispatcher/lease`, async ({ request }) => {
          capturedAuthHeader = request.headers.get("Authorization");
          return HttpResponse.json({ events: [] });
        }),
      );

      await runOnce({ internalApiToken: "secret-token" });

      expect(capturedAuthHeader).toBe("Bearer secret-token");
    });
  });

  describe("error resilience", () => {
    it("continues processing when report endpoint fails", async () => {
      let targetCallCount = 0;

      server.use(
        http.post(`${BASE_URL}/internal/dispatcher/lease`, () =>
          HttpResponse.json({ events: [makeLeasedEvent()] }),
        ),
        http.post(TARGET_URL, () => {
          targetCallCount++;
          return HttpResponse.text("OK", { status: 200 });
        }),
        http.post(`${BASE_URL}/internal/dispatcher/report`, () =>
          HttpResponse.text("Internal Server Error", { status: 500 }),
        ),
      );

      await runOnce();

      expect(targetCallCount).toBe(1);
    });

    it("captures response body in attempt record", async () => {
      const capturedReports: ReportRequest[] = [];

      server.use(
        http.post(`${BASE_URL}/internal/dispatcher/lease`, () =>
          HttpResponse.json({ events: [makeLeasedEvent()] }),
        ),
        http.post(TARGET_URL, () => HttpResponse.json({ received: true }, { status: 200 })),
        http.post(`${BASE_URL}/internal/dispatcher/report`, async ({ request }) => {
          capturedReports.push((await request.json()) as ReportRequest);
          return HttpResponse.json({ circuit: null });
        }),
      );

      await runOnce();

      expect(capturedReports).toHaveLength(1);
      expect(capturedReports[0].attempt.response_body).toBe('{"received":true}');
    });
  });
});
