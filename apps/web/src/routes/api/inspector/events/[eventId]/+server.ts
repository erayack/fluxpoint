import type { RequestHandler } from "./$types.js";
import { GetEventResponseSchema } from "@repo/api";
import { Effect } from "effect";
import { createProxyFetch, requireDashboardKey, runProxy } from "$lib/server/proxyHelper.js";

export const GET: RequestHandler = async ({ params, request }) => {
  return runProxy(
    Effect.gen(function* () {
      yield* requireDashboardKey(request);
      return yield* createProxyFetch(GetEventResponseSchema, {
        path: `/api/inspector/events/${params.eventId}`,
      });
    }),
  );
};
