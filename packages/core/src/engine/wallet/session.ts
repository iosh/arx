import type { BackgroundSessionServices } from "../../runtime/background/session.js";
import type { KeyringService } from "../../runtime/keyring/KeyringService.js";
import type { WalletSession } from "../types.js";

// Vault lifecycle and unlock state exposed on the wallet surface.
export const createWalletSession = (deps: {
  session: BackgroundSessionServices;
  keyring: Pick<KeyringService, "waitForReady">;
}): WalletSession => {
  const { session, keyring } = deps;

  const getSessionLockState = () => session.unlock.getState();

  // Keyring state settles asynchronously after vault mutations and unlock.
  const waitForReady = async () => {
    await keyring.waitForReady();
  };

  return {
    getStatus: () => session.getStatus(),
    getSessionLockState,
    isUnlocked: () => session.isUnlocked(),
    hasInitializedVault: () => session.hasInitializedVault(),
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
      return getSessionLockState();
    },
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
      return {
        autoLockDurationMs: state.autoLockDurationMs,
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
