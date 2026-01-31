import type { Handle, HandleServerError } from "@sveltejs/kit";
import { Effect } from "effect";

export const handle: Handle = async ({ event, resolve }) => {
  const existingRequestId = event.request.headers.get("x-request-id");
  const requestId = existingRequestId ?? crypto.randomUUID();
  event.locals.requestId = requestId;

  const response = await resolve(event);
  response.headers.set("x-request-id", requestId);

  return response;
};

export const handleError: HandleServerError = ({ error, event }) => {
  const errorDetails =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
          cause: error.cause,
        }
      : { message: String(error) };

  Effect.runSync(
    Effect.logError("Unhandled server error").pipe(
      Effect.annotateLogs({
        url: event.url.pathname,
        method: event.request.method,
        requestId: event.locals.requestId ?? event.request.headers.get("x-request-id"),
        ...errorDetails,
      }),
    ),
  );

  return {
    message: "Unexpected error",
  };
};
