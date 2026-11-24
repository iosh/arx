import type { Accounts } from "../accounts/Accounts.js";
import type { Approvals } from "../approvals/Approvals.js";
import type { Approval } from "../approvals/types.js";
import type { DappConnections } from "../dappConnections/DappConnections.js";
import type { ChainRef } from "../networks/chainRef.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import { commitUpdates } from "../persistence/preparedUpdate.js";
import { WalletLockedError } from "../wallet/errors.js";
import type { WalletStatusReader } from "../wallet/Wallet.js";
import { PermissionAccountAccessUnavailableError } from "./errors.js";
import type { Permission, Permissions, PermissionsReader } from "./Permissions.js";
import type { DappScope } from "./scope.js";

export type PermissionsApi = PermissionsReader &
  Readonly<{
    setAccounts(permission: Permission): Promise<void>;
    revoke(scope: DappScope): Promise<void>;
    disconnectOrigin(input: Readonly<{ origin: string }>): Promise<void>;
  }>;

export type DappAuthorization = Readonly<{
  permissions: PermissionsApi;
  requestAccountAccess(input: Readonly<{ scope: DappScope; chainRef: ChainRef }>): Promise<void>;
  closeConnection(scope: DappScope): void;
}>;

export type CreateDappAuthorizationOptions = Readonly<{
  mutations: CoreMutationQueue;
  wallet: WalletStatusReader;
  accounts: Pick<Accounts, "listSelectableAddresses">;
  permissions: Pick<
    Permissions,
    "get" | "list" | "listByOrigin" | "prepareSetAccounts" | "prepareRevoke" | "prepareRevokeOrigin"
  >;
  dappConnections: Pick<DappConnections, "refreshAccountsForOpenConnections" | "isConnectionOpen" | "closeConnection">;
  approvals: Pick<Approvals, "list" | "request" | "cancel">;
}>;

const dependsOnAccountPermission = (approval: Approval): boolean =>
  approval.type === "accountAccess" || approval.type === "sign" || approval.type === "sendTransaction";

const approvalIdsForScope = (
  approvals: readonly Approval[],
  scope: DappScope,
  matches: (approval: Approval) => boolean,
) =>
  approvals
    .filter(
      (approval) => approval.origin === scope.origin && approval.namespace === scope.namespace && matches(approval),
    )
    .map((approval) => approval.approvalId);

export const createDappAuthorization = (options: CreateDappAuthorizationOptions): DappAuthorization => {
  const cancelScopeApprovals = (scope: DappScope, matches: (approval: Approval) => boolean) => {
    options.approvals.cancel(approvalIdsForScope(options.approvals.list(), scope, matches));
  };

  const setAccounts = async (permission: Permission): Promise<void> => {
    await options.mutations.run(async (commit) => {
      if (options.wallet.getStatus() !== "unlocked") throw new WalletLockedError();

      const permissionUpdate = options.permissions.prepareSetAccounts(permission);
      await commitUpdates(commit, [permissionUpdate]);
      if (permissionUpdate) options.dappConnections.refreshAccountsForOpenConnections();
    });
  };

  const requestAccountAccess = async ({
    scope,
    chainRef,
  }: Readonly<{ scope: DappScope; chainRef: ChainRef }>): Promise<void> => {
    if (options.wallet.getStatus() === "uninitialized") {
      throw new PermissionAccountAccessUnavailableError(scope.namespace);
    }

    const [firstAccount, ...remainingAccounts] = options.accounts.listSelectableAddresses(chainRef);
    if (!firstAccount) throw new PermissionAccountAccessUnavailableError(scope.namespace);

    const approval = options.approvals.request<"accountAccess">({
      type: "accountAccess",
      ...scope,
      request: {
        selectableAccounts: [firstAccount, ...remainingAccounts],
      },
    });
    const decision = await approval.decision;

    await setAccounts({
      ...scope,
      accountIds: decision.accountIds,
    });
  };

  const revoke = async (scope: DappScope): Promise<void> => {
    await options.mutations.run(async (commit) => {
      const permissionUpdate = options.permissions.prepareRevoke(scope);
      await commitUpdates(commit, [permissionUpdate]);
      if (permissionUpdate) options.dappConnections.refreshAccountsForOpenConnections();

      // An approval can be created while persistence is committing, so select cancellation targets after activation.
      cancelScopeApprovals(scope, dependsOnAccountPermission);
    });
  };

  const disconnectOrigin = async ({ origin }: Readonly<{ origin: string }>): Promise<void> => {
    await options.mutations.run(async (commit) => {
      const permissionUpdate = options.permissions.prepareRevokeOrigin(origin);
      await commitUpdates(commit, [permissionUpdate]);
      if (permissionUpdate) options.dappConnections.refreshAccountsForOpenConnections();

      options.approvals.cancel(
        options.approvals
          .list()
          .filter((approval) => approval.origin === origin)
          .map((approval) => approval.approvalId),
      );
    });
  };

  const closeConnection = (scope: DappScope): void => {
    if (!options.dappConnections.isConnectionOpen(scope)) return;

    options.dappConnections.closeConnection(scope);
    cancelScopeApprovals(scope, () => true);
  };

  return {
    permissions: {
      get: (scope) => options.permissions.get(scope),
      list: () => options.permissions.list(),
      listByOrigin: (origin) => options.permissions.listByOrigin(origin),
      setAccounts,
      revoke,
      disconnectOrigin,
    },
    requestAccountAccess,
    closeConnection,
  };
};
