import type { Accounts } from "../../accounts/Accounts.js";
import type { AccountAddress } from "../../accounts/types.js";
import type { ChainRef } from "../../networks/chainRef.js";
import type { PermissionsReader } from "../../permissions/Permissions.js";
import { RpcUnauthorizedError } from "../../rpc/errors.js";
import { EIP155_NAMESPACE } from "./constants.js";

type AuthorizedAccountDependencies = Readonly<{
  accounts: Pick<Accounts, "accountIdFromAddress" | "getAccount" | "getAddress">;
  permissions: Pick<PermissionsReader, "get">;
}>;

export const getAuthorizedAccount = (
  dependencies: AuthorizedAccountDependencies,
  input: Readonly<{ origin: string; chainRef: ChainRef; address: string }>,
): AccountAddress => {
  const accountId = dependencies.accounts.accountIdFromAddress({
    chainRef: input.chainRef,
    address: input.address,
  });
  const permission = dependencies.permissions.get({
    origin: input.origin,
    namespace: EIP155_NAMESPACE,
  });
  const account = dependencies.accounts.getAccount(accountId);

  if (!permission?.accountIds.includes(accountId) || !account || account.hidden) {
    throw new RpcUnauthorizedError();
  }

  return dependencies.accounts.getAddress({ chainRef: input.chainRef, accountId });
};
