import { Effect, ManagedRuntime } from "effect";
import { HttpClient, KeyValueStore } from "@effect/platform";
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { BrowserHttpLayer, BrowserKeyValueStoreLayer } from "@repo/core";

const mockLocalStorage = {
  store: new Map<string, string>(),
  getItem(key: string) {
    return this.store.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    this.store.set(key, value);
  },
  removeItem(key: string) {
    this.store.delete(key);
  },
  clear() {
    this.store.clear();
  },
  get length() {
    return this.store.size;
  },
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  },
};

beforeAll(() => {
  vi.stubGlobal("localStorage", mockLocalStorage);
  vi.stubGlobal(
    "XMLHttpRequest",
    class {
      open() {}
      send() {}
      setRequestHeader() {}
      abort() {}
    },
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("appRuntime", () => {
  it("initializes correctly and is a valid ManagedRuntime", async () => {
    const { appRuntime } = await import("./runtime.js");

    expect(appRuntime).toBeDefined();
    expect(typeof appRuntime.runPromise).toBe("function");
    expect(typeof appRuntime.runSync).toBe("function");
    expect(typeof appRuntime.runFork).toBe("function");
  });

  it("provides HttpClient service from BrowserHttpLayer", async () => {
    const testRuntime = ManagedRuntime.make(BrowserHttpLayer);

    const program = Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      return client;
    });

    const result = await testRuntime.runPromise(program);
    expect(result).toBeDefined();
    expect(typeof result.execute).toBe("function");

    await testRuntime.dispose();
  });

  it("provides KeyValueStore service from BrowserKeyValueStoreLayer", async () => {
    const testRuntime = ManagedRuntime.make(BrowserKeyValueStoreLayer);

    const program = Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore;
      return store;
    });

    const result = await testRuntime.runPromise(program);
    expect(result).toBeDefined();
    expect(typeof result.get).toBe("function");
    expect(typeof result.set).toBe("function");

    await testRuntime.dispose();
  });
});
