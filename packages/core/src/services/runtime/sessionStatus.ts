import type { UnlockService } from "../../runtime/session/unlock/types.js";
import type { VaultService } from "../../vault/types.js";

export type SessionLifecycleStatus = "uninitialized" | "locked" | "unlocked";

export type SessionStatus = {
  status: SessionLifecycleStatus;
  vaultInitialized: boolean;
  isUnlocked: boolean;
  autoLockDurationMs: number;
  nextAutoLockAt: number | null;
};

export type SessionStatusService = {
  getStatus(): SessionStatus;
  isUnlocked(): boolean;
  hasInitializedVault(): boolean;
};

type CreateSessionStatusServiceDeps = {
  unlock: Pick<UnlockService, "getState" | "isUnlocked">;
  vault: Pick<VaultService, "getStatus">;
};

export const createSessionStatusService = ({ unlock, vault }: CreateSessionStatusServiceDeps): SessionStatusService => {
  const getStatus = (): SessionStatus => {
    const unlockState = unlock.getState();
    const vaultInitialized = vault.getStatus().hasEnvelope;
    const isUnlocked = unlockState.status === "unlocked";

    return {
      status: unlockState.status,
      vaultInitialized,
      isUnlocked,
      autoLockDurationMs: unlockState.autoLockDurationMs,
      nextAutoLockAt: unlockState.nextAutoLockAt,
    };
  };

  return {
    getStatus,
    isUnlocked: () => unlock.isUnlocked(),
    hasInitializedVault: () => vault.getStatus().hasEnvelope,
  };
};
