import { z } from "zod";
import { defineMethod } from "./types.js";

const UnlockReasonSchema = z.enum(["manual", "timeout", "blur", "suspend", "reload"]);

export const UnlockStateSchema = z.strictObject({
  isUnlocked: z.boolean(),
  timeoutMs: z.number().int().nonnegative(),
  nextAutoLockAt: z.number().int().nullable(),
  lastUnlockedAt: z.number().int().nullable(),
});

const SetAutoLockDurationResultSchema = z.strictObject({
  autoLockDurationMs: z.number().int().nonnegative(),
  nextAutoLockAt: z.number().int().nullable(),
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
    z.strictObject({ durationMs: z.number().finite() }),
    SetAutoLockDurationResultSchema,
    { broadcastSnapshot: true, persistVaultMeta: true },
  ),
} as const;
