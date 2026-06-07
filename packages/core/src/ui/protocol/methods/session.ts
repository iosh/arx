import { z } from "zod";
import { MAX_AUTO_LOCK_MS, MIN_AUTO_LOCK_MS } from "../../../runtime/session/unlock/constants.js";
import { defineMethod } from "./types.js";

const UnlockReasonSchema = z.enum(["manual", "timeout", "blur", "suspend", "reload"]);

const AutoLockDurationMsSchema = z
  .number()
  .transform((value) => Math.round(value))
  .refine((value) => value >= MIN_AUTO_LOCK_MS && value <= MAX_AUTO_LOCK_MS, {
    message: "Auto-lock duration must be between 1 and 60 minutes",
  });

export const sessionMethods = {
  "ui.session.unlock": defineMethod("command", z.strictObject({ password: z.string().min(1) }), {
    broadcastSnapshot: true,
    persistVaultMeta: true,
    holdBroadcast: true,
  }),

  "ui.session.lock": defineMethod("command", z.strictObject({ reason: UnlockReasonSchema.optional() }).optional(), {
    broadcastSnapshot: true,
    persistVaultMeta: true,
  }),

  "ui.session.resetAutoLockTimer": defineMethod("command", z.undefined(), {
    broadcastSnapshot: true,
    persistVaultMeta: true,
  }),

  "ui.session.setAutoLockDuration": defineMethod("command", z.strictObject({ durationMs: AutoLockDurationMsSchema }), {
    broadcastSnapshot: true,
    persistVaultMeta: true,
  }),
} as const;
