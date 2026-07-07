import type { WalletSession } from "../../engine/types.js";
import { SessionLockedError } from "../../runtime/session/errors.js";
import type { LockSessionInput, SetAutoLockDurationInput, UnlockSessionInput } from "../api.js";

export const assertSessionUnlocked = (session: Pick<WalletSession, "isUnlocked">): void => {
  if (!session.isUnlocked()) {
    throw new SessionLockedError();
  }
};

export const createSessionHandlers = (session: WalletSession) => ({
  getStatus: () => session.getStatus(),
  unlock: async (input: UnlockSessionInput) => await session.unlock(input),
  lock: async (input?: LockSessionInput) => session.lock(input?.reason ?? "manual"),
  resetAutoLockTimer: async () => session.resetAutoLockTimer(),
  setAutoLockDuration: async (input: SetAutoLockDurationInput) => session.setAutoLockDuration(input.durationMs),
});
