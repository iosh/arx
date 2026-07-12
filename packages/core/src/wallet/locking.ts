import { createUnlockedSignersDraft } from "../keyring/UnlockedSigners.js";
import { persistenceChange } from "../persistence/change.js";
import { settingPersistenceType } from "../settings/persistence.js";
import { changeVaultPassword, unlockVaultRecord } from "../vault/crypto.js";
import { encryptedVaultPersistenceType } from "../vault/persistence.js";
import { assertAutoLockDuration } from "./AutoLockTimer.js";
import type { WalletContext } from "./Wallet.js";

export const unlock = async (wallet: WalletContext, password: string): Promise<void> => {
  const unlocked = await unlockVaultRecord(wallet.vault.requireRecord(), password);
  const sourceIds = unlocked.secrets.keySources.map((source) => source.keySourceId);
  const privateSourceIds = unlocked.secrets.keySources
    .filter((source) => source.type === "private-key")
    .map((source) => source.keySourceId);
  const keyrings = await wallet.readers.hdKeyrings.listByKeySourceIds(sourceIds);
  const [hdAccounts, privateAccounts] = await Promise.all([
    wallet.readers.accounts.listByKeyringIds(keyrings.map((keyring) => keyring.keyringId)),
    wallet.readers.accounts.listByPrivateKeySourceIds(privateSourceIds),
  ]);
  const signers = createUnlockedSignersDraft({
    sources: unlocked.secrets.keySources,
    keyrings,
    accounts: [...hdAccounts, ...privateAccounts],
    adapters: wallet.adapters,
  });
  wallet.vault.replaceUnlocked(unlocked);
  wallet.signers.replace(signers);
  wallet.autoLock.start();
  wallet.publishChanged({ vault: true });
};

export const lock = (wallet: WalletContext): boolean => {
  if (wallet.vault.getStatus() !== "unlocked") return false;
  wallet.autoLock.stop();
  wallet.signers.clear();
  wallet.vault.lock();
  wallet.publishChanged({ vault: true });
  return true;
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
    wallet.vault.replaceUnlocked(draft);
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
