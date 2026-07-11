import { type AccountId, getAccountIdNamespace } from "./addressing/accountId.js";
import { AccountNotFoundError, AccountOperationRejectedError } from "./errors.js";
import type { AccountRecord, AccountSelectionRecord, NamespaceAccounts } from "./persistence.js";

export const createAccountRecord = (params: {
  accountId: AccountId;
  origin: AccountRecord["origin"];
  createAt: number;
}): AccountRecord => ({
  accountId: params.accountId,
  origin: params.origin,
  hidden: false,
  createAt: params.createAt,
});

export const renameAccount = (account: AccountRecord, alias: string | undefined): AccountRecord => {
  const { alias: _previousAlias, ...record } = account;
  return alias === undefined ? record : { ...record, alias };
};

export const setAccountHidden = (state: NamespaceAccounts, accountId: AccountId, hidden: boolean): AccountRecord => {
  const account = state.accounts.find((candidate) => candidate.accountId === accountId);
  if (!account) throw new AccountNotFoundError(accountId);
  if (hidden && state.selection.accountId === accountId) {
    throw new AccountOperationRejectedError("selected_account_cannot_be_hidden");
  }
  return { ...account, hidden };
};

export const selectAccount = (state: NamespaceAccounts, accountId: AccountId): AccountSelectionRecord | null => {
  const account = state.accounts.find((candidate) => candidate.accountId === accountId);
  if (!account) throw new AccountNotFoundError(accountId);
  const namespace = getAccountIdNamespace(accountId);
  if (account.hidden || namespace !== state.selection.namespace) {
    throw new AccountOperationRejectedError("account_not_visible_in_namespace");
  }
  if (state.selection.accountId === accountId) return null;
  return { namespace, accountId };
};
