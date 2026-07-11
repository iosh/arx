import { ArxBaseError } from "../error.js";

export class AutoLockDurationOutOfRangeError extends ArxBaseError {
  static readonly code = "settings.auto_lock_duration_out_of_range";

  constructor(durationMs: number) {
    super("Auto-lock duration is outside the supported range.", {
      code: AutoLockDurationOutOfRangeError.code,
      details: { durationMs },
    });
  }
}
