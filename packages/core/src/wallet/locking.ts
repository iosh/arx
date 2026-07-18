import { decodeKeyringSecrets, type KeyringSecrets } from "../keyring/secrets.js";
import { persistenceChange } from "../persistence/change.js";
import { settingPersistenceType } from "../settings/persistence.js";
import { changeVaultPassword, unlockVaultRecord } from "../vault/crypto.js";
import { encryptedVaultPersistenceType } from "../vault/persistence.js";
import { assertAutoLockDuration } from "./AutoLockTimer.js";
import { WalletUnlockFailedError } from "./errors.js";
import type { WalletContext } from "./Wallet.js";

export const unlock = async (wallet: WalletContext, password: string): Promise<void> => {
  await wallet.mutations.run(async () => {
    const draft = await unlockVaultRecord(wallet.vault.requireRecord(), password);

    let secrets: KeyringSecrets;
    try {
      secrets = decodeKeyringSecrets(draft.plaintext);
    } catch (cause) {
      throw new WalletUnlockFailedError(cause);
    }

    wallet.vault.activate(draft.unlocked);
    wallet.keyring.activate(secrets);
    wallet.autoLock.start();
    wallet.publishChanged({ vault: true });
  });
};

export const lock = async (wallet: WalletContext): Promise<void> => {
  await wallet.mutations.run(async () => {
    if (wallet.vault.getStatus() !== "unlocked") return;

    wallet.autoLock.stop();
    wallet.keyring.lock();
    wallet.vault.lock();
    wallet.publishChanged({ vault: true });
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
    wallet.autoLock.start();
    wallet.publishChanged({ vault: true });
  });
};

export const setAutoLockDuration = async (wallet: WalletContext, durationMs: number): Promise<void> => {
  assertAutoLockDuration(durationMs);

  await wallet.mutations.run(async (commit) => {
    if (wallet.autoLock.getDuration() === durationMs) return;

    await commit([
      persistenceChange.put(settingPersistenceType, {
        key: "autoLock",
        value: { durationMs },
      }),
    ]);

    wallet.autoLock.updateDuration(durationMs);
    wallet.publishChanged({ autoLock: true });
  });
};
