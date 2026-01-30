import { Schema } from "effect";
import { TargetCircuitStateSchema } from "./leaseResponse.js";
import { WebhookEventSummarySchema } from "./listEventsResponse.js";

export const ReplayEventResponseSchema = Schema.Struct({
  event: WebhookEventSummarySchema,
  circuit: Schema.NullOr(TargetCircuitStateSchema),
});
