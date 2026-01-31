import { Schedule, Duration } from "effect";

export const transientApiRetrySchedule = Schedule.exponential(Duration.millis(100)).pipe(
  Schedule.intersect(Schedule.recurs(5)),
);
