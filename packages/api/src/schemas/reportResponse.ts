import { Schema } from "effect";
import { TargetCircuitStateSchema } from "./leaseResponse.js";

export const ReportResponseSchema = Schema.Struct({
  circuit: Schema.NullOr(TargetCircuitStateSchema),
});
