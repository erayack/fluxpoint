import { Config, Context, Effect, Layer, Option } from "effect";

export interface DispatcherConfigService {
  readonly workerId: string;
  readonly internalApiBaseUrl: string;
  readonly internalApiToken: string | undefined;
  readonly pollIntervalMs: number;
  readonly batchSize: number;
  readonly concurrency: number;
  readonly leaseMs: number;
  readonly requestTimeoutMs: number;
  readonly immediateRetryMax: number;
  readonly maxAttempts: number;
}

export class DispatcherConfig extends Context.Tag("DispatcherConfig")<
  DispatcherConfig,
  DispatcherConfigService
>() {}

const configFromEnv = Config.all({
  workerId: Config.string("FLUXPOINT_WORKER_ID"),
  internalApiBaseUrl: Config.string("FLUXPOINT_RUST_API_BASE_URL"),
  internalApiToken: Config.option(Config.string("FLUXPOINT_RUST_API_TOKEN")),
  pollIntervalMs: Config.integer("FLUXPOINT_DISPATCH_POLL_INTERVAL_MS").pipe(
    Config.withDefault(5000),
  ),
  batchSize: Config.integer("FLUXPOINT_DISPATCH_BATCH_SIZE").pipe(Config.withDefault(50)),
  concurrency: Config.integer("FLUXPOINT_DISPATCH_CONCURRENCY").pipe(Config.withDefault(10)),
  leaseMs: Config.integer("FLUXPOINT_DISPATCH_LEASE_MS").pipe(Config.withDefault(30000)),
  requestTimeoutMs: Config.integer("FLUXPOINT_DISPATCH_REQUEST_TIMEOUT_MS").pipe(
    Config.withDefault(10000),
  ),
  immediateRetryMax: Config.integer("FLUXPOINT_DISPATCH_IMMEDIATE_RETRY_MAX").pipe(
    Config.withDefault(2),
  ),
  maxAttempts: Config.integer("FLUXPOINT_DISPATCH_MAX_ATTEMPTS").pipe(Config.withDefault(10)),
});

export const DispatcherConfigLive = Layer.effect(
  DispatcherConfig,
  Effect.gen(function* () {
    const config = yield* configFromEnv;
    return {
      workerId: config.workerId,
      internalApiBaseUrl: config.internalApiBaseUrl,
      internalApiToken: Option.getOrUndefined(config.internalApiToken),
      pollIntervalMs: config.pollIntervalMs,
      batchSize: config.batchSize,
      concurrency: config.concurrency,
      leaseMs: config.leaseMs,
      requestTimeoutMs: config.requestTimeoutMs,
      immediateRetryMax: config.immediateRetryMax,
      maxAttempts: config.maxAttempts,
    };
  }),
);
