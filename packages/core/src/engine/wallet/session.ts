import type { BackgroundSessionServices } from "../../runtime/background/session.js";
import type { KeyringService } from "../../runtime/keyring/KeyringService.js";
import type { SessionStatusService } from "../../services/runtime/sessionStatus.js";
import type { WalletSession } from "../types.js";

// Vault lifecycle and unlock state exposed on the wallet surface.
export const createWalletSession = (deps: {
  session: BackgroundSessionServices;
  sessionStatus: SessionStatusService;
  keyring: Pick<KeyringService, "waitForReady">;
}): WalletSession => {
  const { session, sessionStatus, keyring } = deps;

  const getUnlockState = () => session.unlock.getState();

  // Keyring state settles asynchronously after vault mutations and unlock.
  const waitForReady = async () => {
    await keyring.waitForReady();
  };

  return {
    getStatus: () => sessionStatus.getStatus(),
    getUnlockState,
    isUnlocked: () => sessionStatus.isUnlocked(),
    hasInitializedVault: () => sessionStatus.hasInitializedVault(),
    createVault: async (params) => {
      const envelope = await session.createVault(params);
      await waitForReady();
      return envelope;
    },
    importVault: async (envelope) => {
      const importedEnvelope = await session.importVault(envelope);
      await waitForReady();
      return importedEnvelope;
    },
    unlock: async (params) => {
      await session.unlock.unlock(params);
      await waitForReady();
      return getUnlockState();
    },
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
      return {
        autoLockDurationMs: state.timeoutMs,
        nextAutoLockAt: state.nextAutoLockAt,
      };
    },
    verifyPassword: (password) => session.vault.verifyPassword(password),
    getVaultMetaState: () => session.getVaultMetaState(),
    getLastPersistedVaultMeta: () => session.getLastPersistedVaultMeta(),
    persistVaultMeta: () => session.persistVaultMeta(),
    onStateChanged: (listener) => session.onStateChanged(listener),
    onUnlocked: (listener) => session.unlock.onUnlocked(listener),
    onLocked: (listener) => session.unlock.onLocked(listener),
  };
};
