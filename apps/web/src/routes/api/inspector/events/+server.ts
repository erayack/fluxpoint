import type { RequestHandler } from "./$types.js";
import { ListEventsResponseSchema } from "@repo/api";
import { Effect } from "effect";
import { createProxyFetch, requireDashboardKey, runProxy } from "$lib/server/proxyHelper.js";

export const GET: RequestHandler = async ({ url, request, locals }) => {
  return runProxy(
    Effect.gen(function* () {
      yield* requireDashboardKey(request);
      return yield* createProxyFetch(ListEventsResponseSchema, {
        path: "/api/inspector/events",
        query: url.searchParams,
        signal: request.signal,
        requestId: locals.requestId,
      });
    }),
  );
};
