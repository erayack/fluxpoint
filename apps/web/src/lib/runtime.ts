import { Layer, ManagedRuntime } from "effect";
import { BrowserHttpLayer, BrowserKeyValueStoreLayer } from "@repo/core";

export const appRuntime = ManagedRuntime.make(
  Layer.mergeAll(BrowserHttpLayer, BrowserKeyValueStoreLayer),
);
