import { Cause, ConfigProvider, Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";

import { DispatcherConfig, DispatcherConfigLive } from "./dispatcherConfig.js";

const baseEnv = {
  FLUXPOINT_WORKER_ID: "worker-1",
  FLUXPOINT_RUST_API_BASE_URL: "http://localhost:3000",
};

const program = Effect.gen(function* () {
  return yield* DispatcherConfig;
});

const runConfig = (env: Record<string, string>) => {
  const provider = ConfigProvider.fromMap(new Map(Object.entries(env)));
  const effect = Effect.withConfigProvider(provider)(Effect.provide(program, DispatcherConfigLive));

  return Effect.runPromise(effect);
};

const getConfigFailure = async (env: Record<string, string>) => {
  const provider = ConfigProvider.fromMap(new Map(Object.entries(env)));
  const effect = Effect.withConfigProvider(provider)(Effect.provide(program, DispatcherConfigLive));
  const exit = await Effect.runPromiseExit(effect);

  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) {
    return undefined;
  }

  return Option.getOrUndefined(Cause.failureOption(exit.cause));
};

describe("DispatcherConfigLive", () => {
  it("fails when FLUXPOINT_WORKER_ID is missing", async () => {
    const failure = await getConfigFailure({
      FLUXPOINT_RUST_API_BASE_URL: baseEnv.FLUXPOINT_RUST_API_BASE_URL,
    });

    expect(failure).toMatchObject({ _tag: "ConfigError" });
  });

  it("fails when FLUXPOINT_RUST_API_BASE_URL is missing", async () => {
    const failure = await getConfigFailure({
      FLUXPOINT_WORKER_ID: baseEnv.FLUXPOINT_WORKER_ID,
    });

    expect(failure).toMatchObject({ _tag: "ConfigError" });
  });

  it("maps missing token to undefined", async () => {
    const config = await runConfig(baseEnv);
    expect(config.internalApiToken).toBeUndefined();
  });

  it("maps provided token to string", async () => {
    const config = await runConfig({
      ...baseEnv,
      FLUXPOINT_RUST_API_TOKEN: "secret-token",
    });

    expect(config.internalApiToken).toBe("secret-token");
  });

  it("uses default values for unset integers", async () => {
    const config = await runConfig(baseEnv);

    expect(config.pollIntervalMs).toBe(5000);
    expect(config.batchSize).toBe(50);
    expect(config.concurrency).toBe(10);
    expect(config.leaseMs).toBe(30000);
    expect(config.requestTimeoutMs).toBe(10000);
    expect(config.immediateRetryMax).toBe(2);
    expect(config.maxAttempts).toBe(10);
  });

  it("fails when integer envs are invalid", async () => {
    const failure = await getConfigFailure({
      ...baseEnv,
      FLUXPOINT_DISPATCH_BATCH_SIZE: "nope",
    });

    expect(failure).toMatchObject({ _tag: "ConfigError" });
  });
});
