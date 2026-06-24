import { SessionLockedError } from "../../runtime/session/errors.js";
import type { LockSessionInput, SetAutoLockDurationInput, UnlockSessionInput } from "../api.js";
import type { WalletApiContext } from "../context.js";

export const assertSessionUnlocked = (context: WalletApiContext): void => {
  if (!context.session.isUnlocked()) {
    throw new SessionLockedError();
  }
};

export const getSessionStatus = (context: WalletApiContext) => context.session.getStatus();

export const unlockSession = async (context: WalletApiContext, input: UnlockSessionInput) => {
  return await context.session.unlock(input);
};

export const lockSession = async (context: WalletApiContext, input?: LockSessionInput) => {
  return context.session.lock(input?.reason ?? "manual");
};

export const resetAutoLockTimer = async (context: WalletApiContext) => {
  return context.session.resetAutoLockTimer();
};

export const setAutoLockDuration = async (context: WalletApiContext, input: SetAutoLockDurationInput) => {
  return context.session.setAutoLockDuration(input.durationMs);
};
