import type { RequestHandler } from "./$types.js";
import { ReplayEventResponseSchema } from "@repo/api";
import { Effect } from "effect";
import {
  createProxyFetch,
  requireDashboardKey,
  runProxy,
  ProxyError,
} from "$lib/server/proxyHelper.js";

export const POST: RequestHandler = async ({ params, request }) => {
  return runProxy(
    Effect.gen(function* () {
      yield* requireDashboardKey(request);

      const body = yield* Effect.tryPromise({
        try: () => request.json() as Promise<{ reset_circuit?: boolean }>,
        catch: () => new ProxyError(400, "Invalid request body"),
      });

      return yield* createProxyFetch(ReplayEventResponseSchema, {
        path: `/api/inspector/events/${params.eventId}/replay`,
        method: "POST",
        body,
      });
    }),
  );
};
