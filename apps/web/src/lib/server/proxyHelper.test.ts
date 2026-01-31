import { Effect, Schema } from "effect";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { json } from "@sveltejs/kit";

import { ProxyError, requireDashboardKey, createProxyFetch, runProxy } from "./proxyHelper.js";

const TestSchema = Schema.Struct({ id: Schema.String, name: Schema.String });

vi.mock("$env/dynamic/private", () => ({
  env: {
    FLUXPOINT_DASHBOARD_KEY: undefined as string | undefined,
    FLUXPOINT_RUST_PUBLIC_API_BASE_URL: undefined as string | undefined,
    FLUXPOINT_RUST_PUBLIC_API_TOKEN: undefined as string | undefined,
  },
}));

const getEnv = async () => {
  const mod = await import("$env/dynamic/private");
  return mod.env as unknown as {
    FLUXPOINT_DASHBOARD_KEY: string | undefined;
    FLUXPOINT_RUST_PUBLIC_API_BASE_URL: string | undefined;
    FLUXPOINT_RUST_PUBLIC_API_TOKEN: string | undefined;
  };
};

vi.mock("$app/environment", () => ({
  dev: true,
}));

const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

beforeEach(async () => {
  vi.clearAllMocks();
  const env = await getEnv();
  env.FLUXPOINT_DASHBOARD_KEY = undefined;
  env.FLUXPOINT_RUST_PUBLIC_API_BASE_URL = undefined;
  env.FLUXPOINT_RUST_PUBLIC_API_TOKEN = undefined;
});

describe("requireDashboardKey", () => {
  it("succeeds when no env key is set", async () => {
    const request = new Request("http://localhost", {
      headers: {},
    });

    const result = await Effect.runPromise(requireDashboardKey(request));
    expect(result).toBeUndefined();
  });

  it("succeeds when env key is set and header matches", async () => {
    const env = await getEnv();
    env.FLUXPOINT_DASHBOARD_KEY = "secret-key";

    const request = new Request("http://localhost", {
      headers: { "x-fluxpoint-dashboard-key": "secret-key" },
    });

    const result = await Effect.runPromise(requireDashboardKey(request));
    expect(result).toBeUndefined();
  });

  it("fails with 401 Response when env key is set and header is missing", async () => {
    const env = await getEnv();
    env.FLUXPOINT_DASHBOARD_KEY = "secret-key";

    const request = new Request("http://localhost", {
      headers: {},
    });

    const exit = await Effect.runPromiseExit(requireDashboardKey(request));
    expect(exit._tag).toBe("Failure");

    if (exit._tag === "Failure") {
      const response = exit.cause._tag === "Fail" ? exit.cause.error : null;
      expect(response).toBeInstanceOf(Response);
      if (response instanceof Response) {
        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body).toEqual({ error: "Unauthorized" });
      }
    }
  });

  it("fails with 401 Response when env key is set and header is wrong", async () => {
    const env = await getEnv();
    env.FLUXPOINT_DASHBOARD_KEY = "secret-key";

    const request = new Request("http://localhost", {
      headers: { "x-fluxpoint-dashboard-key": "wrong-key" },
    });

    const exit = await Effect.runPromiseExit(requireDashboardKey(request));
    expect(exit._tag).toBe("Failure");

    if (exit._tag === "Failure") {
      const response = exit.cause._tag === "Fail" ? exit.cause.error : null;
      expect(response).toBeInstanceOf(Response);
      if (response instanceof Response) {
        expect(response.status).toBe(401);
      }
    }
  });
});

describe("createProxyFetch", () => {
  it("fails with ProxyError(502) when no base URL is configured", async () => {
    const effect = createProxyFetch(TestSchema, { path: "/test" });

    const exit = await Effect.runPromiseExit(effect);
    expect(exit._tag).toBe("Failure");

    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      const error = exit.cause.error;
      expect(error).toBeInstanceOf(ProxyError);
      expect(error.status).toBe(502);
      expect(error.message).toBe("Upstream not configured");
    }
  });

  it("returns decoded data on successful upstream response", async () => {
    const env = await getEnv();
    env.FLUXPOINT_RUST_PUBLIC_API_BASE_URL = "https://api.example.com";

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "123", name: "Test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const effect = createProxyFetch(TestSchema, { path: "/test" });
    const result = await Effect.runPromise(effect);

    expect(result.data).toEqual({ id: "123", name: "Test" });
    expect(result.status).toBe(200);
  });

  it("fails with ProxyError(502) and generic message on upstream error response", async () => {
    const env = await getEnv();
    env.FLUXPOINT_RUST_PUBLIC_API_BASE_URL = "https://api.example.com";

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "not_found", message: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const effect = createProxyFetch(TestSchema, { path: "/test" });
    const exit = await Effect.runPromiseExit(effect);

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      const error = exit.cause.error;
      expect(error).toBeInstanceOf(ProxyError);
      expect(error.status).toBe(502);
      expect(error.message).toBe("Upstream request failed");
      expect(error.apiError).toEqual({ code: "not_found", message: "Not found" });
    }
  });

  it("fails with ProxyError(502) when upstream returns invalid JSON", async () => {
    const env = await getEnv();
    env.FLUXPOINT_RUST_PUBLIC_API_BASE_URL = "https://api.example.com";

    mockFetch.mockResolvedValueOnce(
      new Response("not json", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const effect = createProxyFetch(TestSchema, { path: "/test" });
    const exit = await Effect.runPromiseExit(effect);

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      const error = exit.cause.error;
      expect(error).toBeInstanceOf(ProxyError);
      expect(error.status).toBe(502);
    }
  });

  it("fails with ProxyError(502) when response doesn't match schema", async () => {
    const env = await getEnv();
    env.FLUXPOINT_RUST_PUBLIC_API_BASE_URL = "https://api.example.com";

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ wrong: "shape" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const effect = createProxyFetch(TestSchema, { path: "/test" });
    const exit = await Effect.runPromiseExit(effect);

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      const error = exit.cause.error;
      expect(error).toBeInstanceOf(ProxyError);
      expect(error.status).toBe(502);
      expect(error.message).toBe("Upstream request failed");
    }
  });

  it("appends query params correctly", async () => {
    const env = await getEnv();
    env.FLUXPOINT_RUST_PUBLIC_API_BASE_URL = "https://api.example.com";

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "123", name: "Test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const query = new URLSearchParams({ foo: "bar", baz: "qux" });
    const effect = createProxyFetch(TestSchema, { path: "/test", query });
    await Effect.runPromise(effect);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/test?foo=bar&baz=qux",
      expect.any(Object),
    );
  });

  it("sends JSON body for POST requests", async () => {
    const env = await getEnv();
    env.FLUXPOINT_RUST_PUBLIC_API_BASE_URL = "https://api.example.com";

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "123", name: "Test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const body = { key: "value" };
    const effect = createProxyFetch(TestSchema, { path: "/test", method: "POST", body });
    await Effect.runPromise(effect);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/test",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: expect.any(AbortSignal),
      }),
    );
  });
});

describe("runProxy", () => {
  it("returns json response with data on success", async () => {
    const effect = Effect.succeed({ data: { id: "123", name: "Test" }, status: 200 });
    const response = await runProxy(effect);

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ id: "123", name: "Test" });
  });

  it("returns json response with generic error message on ProxyError", async () => {
    const effect = Effect.fail(new ProxyError(502, "Upstream request failed"));
    const response = await runProxy(effect);

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ error: "Upstream request failed" });
  });

  it("returns the Response as-is when error is a Response", async () => {
    const originalResponse = json({ custom: "error" }, { status: 403 });
    const effect = Effect.fail(originalResponse);
    const response = await runProxy(effect);

    expect(response).toBe(originalResponse);
    expect(response.status).toBe(403);
  });
});
