import { SessionLockedError } from "../../runtime/session/errors.js";
import type { LockSessionInput, SetAutoLockDurationInput, UnlockSessionInput } from "../api.js";
import type { WalletApiContext } from "../context.js";
import { WalletApiSessionSchemas } from "../schemas/session.js";

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
