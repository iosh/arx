import { type AccountId, getAccountIdNamespace } from "../accounts/addressing/accountId.js";
import { accountPersistenceType, accountSelectionPersistenceType } from "../accounts/persistence.js";
import { providerChainSelectionPersistenceType } from "../chains/selection/provider/persistence.js";
import { hdKeyringPersistenceType, keySourcePersistenceType } from "../keyring/persistence.js";
import { removeAccountsFromPermissions } from "../permissions/permissionRecord.js";
import { permissionPersistenceType } from "../permissions/persistence.js";
import { persistenceChange } from "../persistence/change.js";
import { transactionPersistenceType } from "../transactions/persistence.js";
import { encryptedVaultPersistenceType } from "../vault/persistence.js";
import { WalletOperationRejectedError } from "./errors.js";
import type { WalletContext } from "./Wallet.js";

export const selectionChangesForRemovedAccounts = async (
  wallet: WalletContext,
  removedAccountIds: readonly AccountId[],
) => {
  const removed = new Set(removedAccountIds);
  const namespaces = [...new Set(removedAccountIds.map(getAccountIdNamespace))];
  const changes = [];
  for (const namespace of namespaces) {
    const state = await wallet.readers.accounts.getNamespaceAccounts(namespace);
    if (!state) continue;
    const remaining = state.accounts.filter((account) => !removed.has(account.accountId));
    if (remaining.length === 0) {
      changes.push(persistenceChange.remove(accountSelectionPersistenceType, namespace));
    } else if (removed.has(state.selection.accountId)) {
      throw new WalletOperationRejectedError("selected_account_must_be_changed_before_removal");
    }
  }
  return changes;
};

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
    const [sources, keyrings, accountIds, permissions, providerSelections, transactionIds] = await Promise.all([
      wallet.readers.keySources.listAll(),
      wallet.readers.hdKeyrings.listAll(),
      wallet.readers.accounts.listIds(),
      wallet.readers.permissions.listAll(),
      wallet.readers.providerChainSelections.listAll(),
      wallet.readers.transactions.listIds(),
    ]);
    const namespaces = [...new Set(accountIds.map(getAccountIdNamespace))];
    await commit([
      persistenceChange.remove(encryptedVaultPersistenceType),
      ...sources.map((source) => persistenceChange.remove(keySourcePersistenceType, source.keySourceId)),
      ...keyrings.map((keyring) => persistenceChange.remove(hdKeyringPersistenceType, keyring.keyringId)),
      ...accountIds.map((accountId) => persistenceChange.remove(accountPersistenceType, accountId)),
      ...namespaces.map((namespace) => persistenceChange.remove(accountSelectionPersistenceType, namespace)),
      ...permissions.map((permission) =>
        persistenceChange.remove(permissionPersistenceType, {
          origin: permission.origin,
          namespace: permission.namespace,
        }),
      ),
      ...providerSelections.map((selection) =>
        persistenceChange.remove(providerChainSelectionPersistenceType, {
          origin: selection.origin,
          namespace: selection.namespace,
        }),
      ),
      ...transactionIds.map((transactionId) => persistenceChange.remove(transactionPersistenceType, transactionId)),
    ]);
    wallet.autoLock.stop();
    wallet.signers.clear();
    wallet.vault.clear();
    wallet.publishChanged({
      vault: true,
      accounts: accountIds,
      keySources: sources.map((source) => source.keySourceId),
    });
  });
};
