import { ConfigProvider, Effect, Layer } from "effect";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { DispatcherConfigLive, runDispatcher, WebhookStoreLive } from "@repo/core";

const httpLayer = NodeHttpClient.layerUndici;
const configLayer = DispatcherConfigLive;
const storeLayer = Layer.provide(WebhookStoreLive, Layer.merge(configLayer, httpLayer));
const appLayer = Layer.mergeAll(configLayer, storeLayer, httpLayer);

const program = runDispatcher.pipe(
  Effect.provide(appLayer),
  Effect.withConfigProvider(ConfigProvider.fromEnv()),
);

NodeRuntime.runMain(program);
