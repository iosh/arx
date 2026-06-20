import { z } from "zod";
import { MAX_AUTO_LOCK_MS, MIN_AUTO_LOCK_MS } from "../../runtime/session/unlock/constants.js";
import { WalletApiSharedSchemas } from "./shared.js";

const lockReasonSchema = z.enum(["manual", "timeout", "blur", "suspend", "reload"]);

const autoLockDurationMsSchema = z
  .number()
  .transform((value) => Math.round(value))
  .refine((value) => value >= MIN_AUTO_LOCK_MS && value <= MAX_AUTO_LOCK_MS, {
    message: "Auto-lock duration must be between 1 and 60 minutes",
  });

export const WalletApiSessionSchemas = {
  unlock: z.strictObject({ password: WalletApiSharedSchemas.password }),
  lock: z
    .strictObject({
      reason: lockReasonSchema.default("manual"),
    })
    .default({ reason: "manual" }),
  resetAutoLockTimer: z.undefined(),
  setAutoLockDuration: z.strictObject({ durationMs: autoLockDurationMsSchema }),
} satisfies Record<string, z.ZodTypeAny>;
