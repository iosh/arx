import { z } from "zod";
import { MAX_AUTO_LOCK_MS, MIN_AUTO_LOCK_MS } from "../../controllers/unlock/constants.js";
import { defineMethod } from "./types.js";

const UnlockReasonSchema = z.enum(["manual", "timeout", "blur", "suspend", "reload"]);

export const UnlockStateSchema = z.strictObject({
  isUnlocked: z.boolean(),
  timeoutMs: z.number().int().positive(),
  nextAutoLockAt: z.number().int().nullable(),
  lastUnlockedAt: z.number().int().nullable(),
});

const SetAutoLockDurationResultSchema = z.strictObject({
  autoLockDurationMs: z.number().int().positive(),
  nextAutoLockAt: z.number().int().nullable(),
});

const AutoLockDurationMsSchema = z
  .number()
  .transform((value) => Math.round(value))
  .refine((value) => value >= MIN_AUTO_LOCK_MS && value <= MAX_AUTO_LOCK_MS, {
    message: "Auto-lock duration must be between 1 and 60 minutes",
  });

export const sessionMethods = {
  "ui.session.unlock": defineMethod(z.strictObject({ password: z.string().min(1) }), UnlockStateSchema, {
    broadcastSnapshot: true,
    persistVaultMeta: true,
    holdBroadcast: true,
  }),

  "ui.session.lock": defineMethod(
    z.strictObject({ reason: UnlockReasonSchema.optional() }).optional(),
    UnlockStateSchema,
    { broadcastSnapshot: true, persistVaultMeta: true },
  ),

  "ui.session.resetAutoLockTimer": defineMethod(z.undefined(), UnlockStateSchema, {
    broadcastSnapshot: true,
    persistVaultMeta: true,
  }),

  "ui.session.setAutoLockDuration": defineMethod(
    z.strictObject({ durationMs: AutoLockDurationMsSchema }),
    SetAutoLockDurationResultSchema,
    { broadcastSnapshot: true, persistVaultMeta: true },
  ),
} as const;
