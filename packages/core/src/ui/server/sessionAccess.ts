import type { BackgroundSessionServices } from "../../runtime/background/session.js";
import type { KeyringService } from "../../runtime/keyring/KeyringService.js";
import type { SessionLockState, UnlockReason } from "../../runtime/session/unlock/types.js";
import type { SessionStatus, SessionStatusService } from "../../services/runtime/sessionStatus.js";

export type UiStateChangeSubscription = (listener: () => void) => () => void;

export type UiSessionAccess = {
  getStatus: () => SessionStatus;
  getSessionLockState: () => SessionLockState;
  isUnlocked: () => boolean;
  hasInitializedVault: () => boolean;
  unlock: (params: { password: string }) => Promise<SessionLockState>;
  lock: (reason: UnlockReason) => SessionLockState;
  resetAutoLockTimer: () => SessionLockState;
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
  const getSessionLockState: UiSessionAccess["getSessionLockState"] = () => session.unlock.getState();

  const waitForReady = async () => {
    await keyring.waitForReady();
  };

  const unlock: UiSessionAccess["unlock"] = async ({ password }) => {
    await session.unlock.unlock({ password });
    await waitForReady();
    return getSessionLockState();
  };

  return {
    getStatus,
    getSessionLockState,
    isUnlocked: () => sessionStatus.isUnlocked(),
    hasInitializedVault: () => sessionStatus.hasInitializedVault(),
    unlock,
    lock: (reason) => {
      session.unlock.lock(reason);
      return getSessionLockState();
    },
    resetAutoLockTimer: () => {
      session.unlock.scheduleAutoLock();
      return getSessionLockState();
    },
    setAutoLockDuration: (durationMs) => {
      session.unlock.setAutoLockDuration(durationMs);
      const state = getSessionLockState();
      return { autoLockDurationMs: state.autoLockDurationMs, nextAutoLockAt: state.nextAutoLockAt };
    },
    onStateChanged: (listener) => session.onStateChanged(listener),
  };
};
