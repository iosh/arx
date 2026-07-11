import {
  renameAccount as renameAccountRecord,
  selectAccount as selectAccountRecord,
  setAccountHidden as setAccountHiddenRecord,
} from "../accounts/accountRecord.js";
import { type AccountId, getAccountIdNamespace } from "../accounts/addressing/accountId.js";
import { AccountNotFoundError } from "../accounts/errors.js";
import { accountPersistenceType, accountSelectionPersistenceType } from "../accounts/persistence.js";
import { persistenceChange } from "../persistence/change.js";
import { WalletOperationRejectedError, WalletRecordNotFoundError } from "./errors.js";
import { permissionChangesForRemovedAccounts } from "./removal.js";
import type { WalletContext } from "./Wallet.js";

export const renameAccount = async (
  wallet: WalletContext,
  params: { accountId: AccountId; alias?: string },
): Promise<void> => {
  await wallet.mutations.run(async (commit) => {
    const current = await wallet.readers.accounts.get(params.accountId);
    if (!current) throw new AccountNotFoundError(params.accountId);
    const next = renameAccountRecord(current, params.alias);
    await commit([persistenceChange.put(accountPersistenceType, next)]);
    wallet.publishChanged({ accounts: [params.accountId] });
  });
};

export const setAccountHidden = async (
  wallet: WalletContext,
  params: { accountId: AccountId; hidden: boolean },
): Promise<void> => {
  await wallet.mutations.run(async (commit) => {
    const state = await wallet.readers.accounts.getNamespaceAccounts(getAccountIdNamespace(params.accountId));
    if (!state) throw new AccountNotFoundError(params.accountId);
    const next = setAccountHiddenRecord(state, params.accountId, params.hidden);
    if (next.hidden === state.accounts.find((account) => account.accountId === params.accountId)?.hidden) return;
    await commit([persistenceChange.put(accountPersistenceType, next)]);
    wallet.publishChanged({ accounts: [params.accountId] });
  });
};

export const selectAccount = async (wallet: WalletContext, accountId: AccountId): Promise<void> => {
  await wallet.mutations.run(async (commit) => {
    const state = await wallet.readers.accounts.getNamespaceAccounts(getAccountIdNamespace(accountId));
    if (!state) throw new AccountNotFoundError(accountId);
    const next = selectAccountRecord(state, accountId);
    if (!next) return;
    await commit([persistenceChange.put(accountSelectionPersistenceType, next)]);
    wallet.publishChanged({ accounts: [accountId] });
  });
};

export const removeAccount = async (wallet: WalletContext, accountId: AccountId): Promise<void> => {
  await wallet.mutations.run(async (commit) => {
    wallet.vault.requireUnlocked();
    const account = await wallet.readers.accounts.get(accountId);
    if (!account) throw new WalletRecordNotFoundError("account", accountId);
    const namespaceState = await wallet.readers.accounts.getNamespaceAccounts(getAccountIdNamespace(accountId));
    if (!namespaceState) throw new WalletRecordNotFoundError("account", accountId);
    if (namespaceState.selection.accountId === accountId) {
      throw new WalletOperationRejectedError("selected_account_must_be_changed_before_removal");
    }
    if (account.origin.type === "private-key") {
      throw new WalletOperationRejectedError("private_key_account_requires_key_source_removal");
    }
    const keyringAccounts = await wallet.readers.accounts.listByKeyringIds([account.origin.keyringId]);
    if (keyringAccounts.length === 1) {
      throw new WalletOperationRejectedError("last_keyring_account_requires_keyring_removal");
    }
    await commit([
      persistenceChange.remove(accountPersistenceType, accountId),
      ...(await permissionChangesForRemovedAccounts(wallet, [accountId])),
    ]);
    wallet.signers.remove([accountId]);
    wallet.autoLock.restart();
    wallet.publishChanged({ accounts: [accountId] });
  });
};
