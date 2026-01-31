import type { HandleServerError } from "@sveltejs/kit";
import { Effect } from "effect";

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
        ...errorDetails,
      }),
    ),
  );

  return {
    message: "Unexpected error",
  };
};
