import { z } from "zod";
import { SessionLockedError } from "../../runtime/session/errors.js";
import { MAX_AUTO_LOCK_MS, MIN_AUTO_LOCK_MS } from "../../runtime/session/unlock/constants.js";
import type { LockSessionInput, SetAutoLockDurationInput, UnlockSessionInput } from "../api.js";
import type { WalletApiContext } from "../context.js";
import { WalletApiSharedSchemas } from "../schemas/shared.js";

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

export const assertSessionUnlocked = (context: WalletApiContext): void => {
  if (!context.session.isUnlocked()) {
    throw new SessionLockedError();
  }
};

export const unlockSession = async (context: WalletApiContext, input: UnlockSessionInput) => {
  const params = WalletApiSessionSchemas.unlock.parse(input);
  return await context.session.unlock(params);
};

export const lockSession = async (context: WalletApiContext, input?: LockSessionInput) => {
  const params = WalletApiSessionSchemas.lock.parse(input);
  return context.session.lock(params.reason);
};

export const resetAutoLockTimer = async (context: WalletApiContext) => {
  WalletApiSessionSchemas.resetAutoLockTimer.parse(undefined);
  return context.session.resetAutoLockTimer();
};

export const setAutoLockDuration = async (context: WalletApiContext, input: SetAutoLockDurationInput) => {
  const params = WalletApiSessionSchemas.setAutoLockDuration.parse(input);
  return context.session.setAutoLockDuration(params.durationMs);
};
