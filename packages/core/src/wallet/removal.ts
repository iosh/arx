import { accountsChangedFromUpdate } from "../accounts/Accounts.js";
import type { AccountId } from "../accounts/accountId.js";
import { removeAccountsFromPermissions } from "../permissions/permissionRecord.js";
import { permissionPersistenceType } from "../permissions/persistence.js";
import { persistenceChange } from "../persistence/change.js";
import { encryptedVaultPersistenceType } from "../vault/persistence.js";
import { requireKeyringSecrets } from "./unlocked.js";
import type { WalletContext } from "./Wallet.js";

export const permissionChangesForRemovedAccounts = async (wallet: WalletContext, accountIds: readonly AccountId[]) => {
  if (accountIds.length === 0) return [];
  const current = await wallet.readers.permissions.listReferencingAccountIds(accountIds);
  return removeAccountsFromPermissions(current, accountIds).map((permission) =>
    persistenceChange.put(permissionPersistenceType, permission),
  );
};

export const deleteWallet = async (wallet: WalletContext): Promise<void> => {
  await wallet.mutations.run(async (commit) => {
    wallet.vault.requireUnlocked();
    requireKeyringSecrets(wallet);
    const permissions = await wallet.readers.permissions.listAll();
    const accountsUpdate = wallet.accounts.prepareReset();
    const keyringUpdate = wallet.keyring.prepareReset();
    await commit([
      persistenceChange.remove(encryptedVaultPersistenceType),
      ...keyringUpdate.persistenceChanges,
      ...(accountsUpdate?.persistenceChanges ?? []),
      ...permissions.map((permission) =>
        persistenceChange.remove(permissionPersistenceType, {
          origin: permission.origin,
          namespace: permission.namespace,
        }),
      ),
    ]);
    wallet.autoLock.stop();
    wallet.keyring.applyCommittedUpdate(keyringUpdate);
    if (accountsUpdate) wallet.accounts.applyCommittedUpdate(accountsUpdate);
    wallet.keyring.lock();
    wallet.vault.activateDeleted();
    wallet.publishChanged({ vault: true });
    wallet.publishKeyringChanged();
    if (accountsUpdate) wallet.publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));
  });
};
