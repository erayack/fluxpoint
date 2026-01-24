import { Effect, Schedule, Duration, Random, Clock, Either } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpClientError,
} from "@effect/platform";
import type {
  LeasedEvent,
  ReportRequest,
  ReportAttempt,
  ReportOutcome,
  WebhookAttemptErrorKind,
} from "@repo/api";
import { DispatcherConfig } from "../services/dispatcherConfig.js";
import { WebhookStore } from "../services/webhookStore.js";

type RetryableStatusError = {
  _tag: "RetryableStatusError";
  response: HttpClientResponse.HttpClientResponse;
};

type RetryableFailure =
  | HttpClientError.HttpClientError
  | { _tag: "TimeoutException" }
  | RetryableStatusError;

type DeliveryResult = Either.Either<
  HttpClientResponse.HttpClientResponse,
  HttpClientError.HttpClientError | { _tag: "TimeoutException" }
>;

const toISO = (ms: number): string => new Date(ms).toISOString();

const sleepWithJitter = (baseMs: number) =>
  Effect.gen(function* () {
    const jitterRange = Math.floor(baseMs * 0.2);
    const jitter = yield* Random.nextIntBetween(-jitterRange, jitterRange + 1);
    yield* Effect.sleep(Duration.millis(baseMs + jitter));
  });

const isRetryableStatus = (status: number): boolean =>
  status >= 500 || status === 408 || status === 429;

const classifyHttpStatus = (status: number): ReportOutcome => {
  if (status >= 200 && status < 300) return "delivered";
  if (isRetryableStatus(status)) return "retry";
  return "dead";
};

const resolveOutcome = (
  result: DeliveryResult,
  currentAttempts: number,
  maxAttempts: number,
): ReportOutcome => {
  if (Either.isRight(result)) return classifyHttpStatus(result.right.status);
  if (currentAttempts + 1 >= maxAttempts) return "dead";
  return "retry";
};

const classifyError = (
  error: HttpClientError.HttpClientError | { _tag: "TimeoutException" },
): WebhookAttemptErrorKind => {
  if (error._tag === "TimeoutException") return "timeout";
  if (error._tag === "RequestError") return "network";
  if (error._tag === "ResponseError") return "invalid_response";
  return "unexpected";
};

const isRetryableFailure = (error: RetryableFailure): boolean => {
  if (error._tag === "TimeoutException") return true;
  if (error._tag === "RetryableStatusError") return true;
  if (error._tag === "RequestError") return true;
  if (error._tag === "ResponseError") {
    const status = error.response.status;
    return isRetryableStatus(status);
  }
  return false;
};

const isRetryableResult = (result: DeliveryResult): boolean => {
  if (Either.isRight(result)) {
    const status = result.right.status;
    return isRetryableStatus(status);
  }

  const error = result.left;
  if (error._tag === "TimeoutException") return true;
  return isRetryableFailure(error);
};

const buildAttempt = (
  result: DeliveryResult,
  leased: LeasedEvent,
  startedAt: string,
  finishedAt: string,
): Effect.Effect<ReportAttempt> =>
  Effect.gen(function* () {
    const base: Omit<
      ReportAttempt,
      "response_status" | "response_headers" | "response_body" | "error_kind" | "error_message"
    > = {
      started_at: startedAt,
      finished_at: finishedAt,
      request_headers: leased.event.headers,
      request_body: leased.event.payload,
    };

    if (Either.isLeft(result)) {
      const error = result.left;
      return {
        ...base,
        response_status: null,
        response_headers: null,
        response_body: null,
        error_kind: classifyError(error),
        error_message: error._tag === "TimeoutException" ? "Request timed out" : String(error),
      };
    }

    const response = result.right;
    const bodyText = yield* response.text.pipe(Effect.orElseSucceed(() => null));
    const responseHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(response.headers)) {
      if (typeof value === "string") {
        responseHeaders[key] = value;
      }
    }

    return {
      ...base,
      response_status: response.status,
      response_headers: responseHeaders,
      response_body: bodyText,
      error_kind: null,
      error_message: null,
    };
  });

const deliverOne = (leased: LeasedEvent) =>
  Effect.gen(function* () {
    const config = yield* DispatcherConfig;
    const store = yield* WebhookStore;
    const client = yield* HttpClient.HttpClient;

    const startedAt = yield* Clock.currentTimeMillis.pipe(Effect.map(toISO));

    const outReq = HttpClientRequest.post(leased.target_url).pipe(
      HttpClientRequest.setHeaders(leased.event.headers),
      HttpClientRequest.bodyText(leased.event.payload, "application/json"),
    );

    const retrySchedule = Schedule.exponential(Duration.millis(1000)).pipe(
      Schedule.intersect(Schedule.recurs(config.immediateRetryMax)),
      Schedule.whileInput(isRetryableFailure),
    );

    const executeOnce = client.execute(outReq).pipe(
      Effect.timeoutFail({
        duration: Duration.millis(config.requestTimeoutMs),
        onTimeout: () => ({ _tag: "TimeoutException" }) as const,
      }),
      Effect.flatMap((response) =>
        isRetryableStatus(response.status)
          ? Effect.fail<RetryableStatusError>({
              _tag: "RetryableStatusError",
              response,
            })
          : Effect.succeed(response),
      ),
    );

    const result: DeliveryResult = yield* executeOnce.pipe(
      Effect.retry({ schedule: retrySchedule }),
      Effect.catchAll((error) =>
        error._tag === "RetryableStatusError" ? Effect.succeed(error.response) : Effect.fail(error),
      ),
      Effect.either,
    );

    const finishedAt = yield* Clock.currentTimeMillis.pipe(Effect.map(toISO));

    const attempt = yield* buildAttempt(result, leased, startedAt, finishedAt);
    const outcome = resolveOutcome(result, leased.event.attempts, config.maxAttempts);
    const retryable = isRetryableResult(result);
    const nextAttemptAt = null;

    const report: ReportRequest = {
      worker_id: config.workerId,
      event_id: leased.event.id,
      outcome,
      next_attempt_at: nextAttemptAt,
      retryable,
      attempt,
    };

    yield* store
      .report(report)
      .pipe(Effect.catchAll((e) => Effect.logError("Failed to report delivery outcome", e)));
  });

const deliverBatch = (events: readonly LeasedEvent[]) =>
  Effect.gen(function* () {
    const config = yield* DispatcherConfig;
    yield* Effect.forEach(
      events,
      (ev) =>
        deliverOne(ev).pipe(
          Effect.catchAll((e) => Effect.logError(`Failed to deliver event ${ev.event.id}`, e)),
        ),
      { concurrency: config.concurrency },
    );
  });

export const runDispatcherOnce = Effect.gen(function* () {
  const config = yield* DispatcherConfig;
  const store = yield* WebhookStore;

  const leaseResp = yield* store.lease(config.batchSize, config.leaseMs);

  if (leaseResp.events.length === 0) {
    yield* Effect.logDebug("No events to deliver");
    return;
  }

  yield* Effect.logInfo(`Leased ${leaseResp.events.length} events`);
  yield* deliverBatch(leaseResp.events);
});

export const runDispatcher = Effect.gen(function* () {
  const config = yield* DispatcherConfig;

  yield* Effect.logInfo(
    `Dispatcher starting (worker=${config.workerId}, poll=${config.pollIntervalMs}ms, batch=${config.batchSize}, concurrency=${config.concurrency})`,
  );

  yield* Effect.forever(
    runDispatcherOnce.pipe(
      Effect.catchAll((e) => Effect.logError("Poll cycle failed", e)),
      Effect.zipRight(sleepWithJitter(config.pollIntervalMs)),
    ),
  );
});
