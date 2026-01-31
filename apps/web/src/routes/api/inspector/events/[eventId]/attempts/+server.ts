import type { RequestHandler } from "./$types.js";
import { ListAttemptsResponseSchema } from "@repo/api";
import { Effect } from "effect";
import { createProxyFetch, requireDashboardKey, runProxy } from "$lib/server/proxyHelper.js";

export const GET: RequestHandler = async ({ params, request, locals }) => {
  return runProxy(
    Effect.gen(function* () {
      yield* requireDashboardKey(request);
      return yield* createProxyFetch(ListAttemptsResponseSchema, {
        path: `/api/inspector/events/${params.eventId}/attempts`,
        signal: request.signal,
        requestId: locals.requestId,
      });
    }),
  );
};
