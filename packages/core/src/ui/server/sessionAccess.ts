import type { UnlockReason, UnlockState } from "../../controllers/unlock/types.js";
import type { BackgroundSessionServices } from "../../runtime/background/session.js";
import type { KeyringService } from "../../runtime/keyring/KeyringService.js";
import type { SessionStatus, SessionStatusService } from "../../services/runtime/sessionStatus.js";

export type UiStateChangeSubscription = (listener: () => void) => () => void;

export type UiSessionAccess = {
  getStatus: () => SessionStatus;
  getUnlockState: () => UnlockState;
  isUnlocked: () => boolean;
  hasInitializedVault: () => boolean;
  unlock: (params: { password: string }) => Promise<UnlockState>;
  lock: (reason: UnlockReason) => UnlockState;
  resetAutoLockTimer: () => UnlockState;
  setAutoLockDuration: (durationMs: number) => { autoLockDurationMs: number; nextAutoLockAt: number | null };
  onStateChanged: UiStateChangeSubscription;
};

export type CreateUiSessionAccessDeps = {
  session: BackgroundSessionServices;
  sessionStatus: SessionStatusService;
  keyring: KeyringService;
};

export const createUiSessionAccess = ({
  session,
  sessionStatus,
  keyring,
}: CreateUiSessionAccessDeps): UiSessionAccess => {
  const getStatus: UiSessionAccess["getStatus"] = () => sessionStatus.getStatus();
  const getUnlockState: UiSessionAccess["getUnlockState"] = () => session.unlock.getState();

  const waitForReady = async () => {
    await keyring.waitForReady();
  };

  const unlock: UiSessionAccess["unlock"] = async ({ password }) => {
    await session.unlock.unlock({ password });
    await waitForReady();
    return getUnlockState();
  };

  return {
    getStatus,
    getUnlockState,
    isUnlocked: () => sessionStatus.isUnlocked(),
    hasInitializedVault: () => sessionStatus.hasInitializedVault(),
    unlock,
    lock: (reason) => {
      session.unlock.lock(reason);
      return getUnlockState();
    },
    resetAutoLockTimer: () => {
      session.unlock.scheduleAutoLock();
      return getUnlockState();
    },
    setAutoLockDuration: (durationMs) => {
      session.unlock.setAutoLockDuration(durationMs);
      const state = getUnlockState();
      return { autoLockDurationMs: state.timeoutMs, nextAutoLockAt: state.nextAutoLockAt };
    },
    onStateChanged: (listener) => session.onStateChanged(listener),
  };
};
