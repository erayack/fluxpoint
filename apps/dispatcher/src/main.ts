import { ConfigProvider, Effect, Fiber, Layer } from "effect";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { DispatcherConfigLive, runDispatcher, WebhookStoreLive } from "@repo/core";

const httpLayer = NodeHttpClient.layerUndici;
const configLayer = DispatcherConfigLive;
const storeLayer = Layer.provide(WebhookStoreLive, Layer.merge(configLayer, httpLayer));
const appLayer = Layer.mergeAll(configLayer, storeLayer, httpLayer);

const awaitSignal = Effect.async<"SIGINT" | "SIGTERM">((resume) => {
  const handleSigint = () => resume(Effect.succeed("SIGINT"));
  const handleSigterm = () => resume(Effect.succeed("SIGTERM"));

  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);

  return Effect.sync(() => {
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
  });
});

const program = Effect.gen(function* () {
  const fiber = yield* Effect.fork(runDispatcher);

  const handleSignal = awaitSignal.pipe(
    Effect.tap((signal) => Effect.logInfo(`Received ${signal}, interrupting dispatcher`)),
    Effect.zipRight(Fiber.interrupt(fiber)),
  );

  yield* Effect.raceFirst(handleSignal, Fiber.join(fiber));
}).pipe(Effect.provide(appLayer), Effect.withConfigProvider(ConfigProvider.fromEnv()));

NodeRuntime.runMain(program);
