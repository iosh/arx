import type { AccountId } from "../accounts/accountId.js";
import { removeAccountsFromPermissions } from "../permissions/permissionRecord.js";
import { permissionPersistenceType } from "../permissions/persistence.js";
import { persistenceChange } from "../persistence/change.js";
import type { WalletContext } from "./Wallet.js";

export const permissionChangesForRemovedAccounts = async (wallet: WalletContext, accountIds: readonly AccountId[]) => {
  if (accountIds.length === 0) return [];
  const current = await wallet.readers.permissions.listReferencingAccountIds(accountIds);
  return removeAccountsFromPermissions(current, accountIds).map((permission) =>
    persistenceChange.put(permissionPersistenceType, permission),
  );
};
