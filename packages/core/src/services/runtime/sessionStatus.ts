import type { UnlockController } from "../../controllers/unlock/types.js";
import type { VaultService } from "../../vault/types.js";

export type SessionStatusPhase = "uninitialized" | "locked" | "unlocked";

export type SessionStatus = {
  phase: SessionStatusPhase;
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
  unlock: Pick<UnlockController, "getState" | "isUnlocked">;
  vault: Pick<VaultService, "getStatus">;
};

const deriveSessionPhase = (params: { vaultInitialized: boolean; isUnlocked: boolean }): SessionStatusPhase => {
  if (!params.vaultInitialized) {
    return "uninitialized";
  }

  return params.isUnlocked ? "unlocked" : "locked";
};

export const createSessionStatusService = ({ unlock, vault }: CreateSessionStatusServiceDeps): SessionStatusService => {
  const getStatus = (): SessionStatus => {
    const unlockState = unlock.getState();
    const vaultInitialized = vault.getStatus().hasEnvelope;

    return {
      phase: deriveSessionPhase({ vaultInitialized, isUnlocked: unlockState.isUnlocked }),
      vaultInitialized,
      isUnlocked: unlockState.isUnlocked,
      autoLockDurationMs: unlockState.timeoutMs,
      nextAutoLockAt: unlockState.nextAutoLockAt,
    };
  };

  return {
    getStatus,
    isUnlocked: () => unlock.isUnlocked(),
    hasInitializedVault: () => vault.getStatus().hasEnvelope,
  };
};
