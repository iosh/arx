import { type AccountId, getAccountIdNamespace } from "../accounts/accountId.js";
import {
  renameAccount as renameAccountRecord,
  selectAccount as selectAccountRecord,
  setAccountHidden as setAccountHiddenRecord,
} from "../accounts/accountRecord.js";
import { AccountNotFoundError } from "../accounts/errors.js";
import { accountPersistenceType, accountSelectionPersistenceType } from "../accounts/persistence.js";
import { persistenceChange } from "../persistence/change.js";
import { WalletOperationRejectedError } from "./errors.js";
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
    const account = state.accounts.find((candidate) => candidate.accountId === params.accountId);
    if (!account) throw new AccountNotFoundError(params.accountId);
    if (account.origin.type !== "hd") {
      throw new WalletOperationRejectedError("only_hd_accounts_can_be_hidden");
    }
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
