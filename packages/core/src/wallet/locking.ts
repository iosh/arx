import { decodeKeyringSecrets, type KeyringSecrets } from "../keyring/secrets.js";
import { persistenceChange } from "../persistence/change.js";
import { AUTO_LOCK_SETTING_KEY, settingPersistenceType } from "../settings/persistence.js";
import { changeVaultPassword, unlockVaultRecord } from "../vault/crypto.js";
import { encryptedVaultPersistenceType } from "../vault/persistence.js";
import { assertAutoLockDuration, DEFAULT_AUTO_LOCK_DURATION_MS } from "./AutoLockController.js";
import { WalletUnlockFailedError } from "./errors.js";
import type { WalletContext } from "./Wallet.js";

export const unlock = async (wallet: WalletContext, password: string): Promise<void> => {
  await wallet.mutations.run(async () => {
    if (wallet.vault.getStatus() === "unlocked") return;

    const draft = await unlockVaultRecord(wallet.vault.requireRecord(), password);

    let secrets: KeyringSecrets;
    try {
      secrets = decodeKeyringSecrets(draft.plaintext);
    } catch (cause) {
      throw new WalletUnlockFailedError(cause);
    }

    wallet.vault.activate(draft.unlocked);
    wallet.keyring.activateSecrets(secrets);
    wallet.autoLock.start();
    wallet.publishStatusChanged({ type: "walletStatusChanged", status: "unlocked" });
  });
};

export const lock = async (wallet: WalletContext): Promise<void> => {
  await wallet.mutations.run(async () => {
    if (wallet.vault.getStatus() !== "unlocked") return;

    wallet.autoLock.stop();
    wallet.keyring.lock();
    wallet.vault.lock();
    wallet.publishStatusChanged({ type: "walletStatusChanged", status: "locked" });
  });
};

export const changePassword = async (
  wallet: WalletContext,
  params: { currentPassword: string; newPassword: string },
): Promise<void> => {
  await wallet.mutations.run(async (commit) => {
    const draft = await changeVaultPassword({
      unlocked: wallet.vault.requireUnlocked(),
      currentPassword: params.currentPassword,
      newPassword: params.newPassword,
    });

    await commit([persistenceChange.put(encryptedVaultPersistenceType, draft.record)]);

    wallet.vault.activate(draft);
    wallet.autoLock.recordActivity();
  });
};

export const setAutoLockDuration = async (wallet: WalletContext, durationMs: number): Promise<void> => {
  assertAutoLockDuration(durationMs);

  await wallet.mutations.run(async (commit) => {
    if (wallet.autoLock.getDuration() === durationMs) return;

    const change =
      durationMs === DEFAULT_AUTO_LOCK_DURATION_MS
        ? persistenceChange.remove(settingPersistenceType, AUTO_LOCK_SETTING_KEY)
        : persistenceChange.put(settingPersistenceType, {
            key: AUTO_LOCK_SETTING_KEY,
            durationMs,
          });

    await commit([change]);

    wallet.autoLock.applyDuration(durationMs);
  });
};
