import { Schema } from "effect";
import { TargetCircuitStateSchema, WebhookEventSchema } from "./leaseResponse.js";

export const GetEventResponseSchema = Schema.Struct({
  event: WebhookEventSchema,
  target_url: Schema.String,
  circuit: Schema.NullOr(TargetCircuitStateSchema),
});
