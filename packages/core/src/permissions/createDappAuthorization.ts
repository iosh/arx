import type { Approvals } from "../approvals/Approvals.js";
import type { Approval } from "../approvals/types.js";
import type { DappConnections } from "../dappConnections/DappConnections.js";
import type { DappConnectionScope } from "../dappConnections/persistence.js";
import { NetworkNamespaceUnsupportedError } from "../networks/errors.js";
import type { NetworksReader } from "../networks/types.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import { WalletLockedError } from "../wallet/errors.js";
import type { Wallet } from "../wallet/Wallet.js";
import {
  type Permission,
  type Permissions,
  type PermissionsChanged,
  type PermissionsReader,
  permissionsChangedFromUpdate,
} from "./Permissions.js";
import type { PermissionScope } from "./persistence.js";

export type PermissionsApi = PermissionsReader &
  Readonly<{
    setAccounts(permission: Permission): Promise<void>;
    revoke(scope: PermissionScope): Promise<void>;
    disconnectOrigin(input: Readonly<{ origin: string }>): Promise<void>;
  }>;

export type DappAuthorization = Readonly<{
  permissions: PermissionsApi;
  closeConnection(scope: DappConnectionScope): void;
}>;

export type CreateDappAuthorizationOptions = Readonly<{
  mutations: CoreMutationQueue;
  wallet: Pick<Wallet, "getStatus">;
  networks: Pick<NetworksReader, "getSelection">;
  permissions: Pick<
    Permissions,
    | "get"
    | "list"
    | "listByOrigin"
    | "prepareSetAccounts"
    | "prepareRevoke"
    | "prepareRevokeOrigin"
    | "applyCommittedUpdate"
  >;
  dappConnections: Pick<
    DappConnections,
    | "getNetworkSelection"
    | "prepareSelectNetworkIfMissing"
    | "prepareRemoveOriginSelections"
    | "applyCommittedUpdate"
    | "refreshActiveConnectionStates"
    | "isConnectionOpen"
    | "closeConnection"
  >;
  approvals: Pick<Approvals, "list" | "cancel">;
  publishPermissionsChanged(change: PermissionsChanged): void;
}>;

const dependsOnAccountPermission = (approval: Approval): boolean =>
  approval.type === "accountAccess" || approval.type === "sign" || approval.type === "sendTransaction";

const approvalIdsForScope = (
  approvals: readonly Approval[],
  scope: PermissionScope,
  matches: (approval: Approval) => boolean,
) =>
  approvals
    .filter(
      (approval) => approval.origin === scope.origin && approval.namespace === scope.namespace && matches(approval),
    )
    .map((approval) => approval.approvalId);

export const createDappAuthorization = (options: CreateDappAuthorizationOptions): DappAuthorization => {
  const walletChainRefFor = (scope: PermissionScope) => {
    const chainRef = options.networks.getSelection().selectedChainRefByNamespace[scope.namespace];
    if (!chainRef) throw new NetworkNamespaceUnsupportedError(scope.namespace);
    return chainRef;
  };

  const cancelScopeApprovals = (scope: PermissionScope, matches: (approval: Approval) => boolean) => {
    options.approvals.cancel(approvalIdsForScope(options.approvals.list(), scope, matches));
  };

  const setAccounts = async (permission: Permission): Promise<void> => {
    await options.mutations.run(async (commit) => {
      if (options.wallet.getStatus() !== "unlocked") throw new WalletLockedError();

      const scope = { origin: permission.origin, namespace: permission.namespace };
      const permissionUpdate = options.permissions.prepareSetAccounts(permission);
      const existingSelection = options.dappConnections.getNetworkSelection(scope);
      const selectionUpdate = existingSelection
        ? null
        : options.dappConnections.prepareSelectNetworkIfMissing({
            ...scope,
            chainRef: walletChainRefFor(scope),
          });
      if (!permissionUpdate && !selectionUpdate) return;

      await commit([...(permissionUpdate?.persistenceChanges ?? []), ...(selectionUpdate?.persistenceChanges ?? [])]);

      if (permissionUpdate) options.permissions.applyCommittedUpdate(permissionUpdate);
      if (selectionUpdate) options.dappConnections.applyCommittedUpdate(selectionUpdate);
      options.dappConnections.refreshActiveConnectionStates(selectionUpdate?.changedScopes);

      if (permissionUpdate) options.publishPermissionsChanged(permissionsChangedFromUpdate(permissionUpdate));
    });
  };

  const revoke = async (scope: PermissionScope): Promise<void> => {
    await options.mutations.run(async (commit) => {
      const permissionUpdate = options.permissions.prepareRevoke(scope);
      if (permissionUpdate) {
        await commit(permissionUpdate.persistenceChanges);
        options.permissions.applyCommittedUpdate(permissionUpdate);
        options.dappConnections.refreshActiveConnectionStates();
      }

      // An approval can be created while persistence is committing, so select cancellation targets after activation.
      cancelScopeApprovals(scope, dependsOnAccountPermission);

      if (permissionUpdate) options.publishPermissionsChanged(permissionsChangedFromUpdate(permissionUpdate));
    });
  };

  const disconnectOrigin = async ({ origin }: Readonly<{ origin: string }>): Promise<void> => {
    await options.mutations.run(async (commit) => {
      const permissionUpdate = options.permissions.prepareRevokeOrigin(origin);
      const selectionUpdate = options.dappConnections.prepareRemoveOriginSelections(origin);
      if (permissionUpdate || selectionUpdate) {
        await commit([...(permissionUpdate?.persistenceChanges ?? []), ...(selectionUpdate?.persistenceChanges ?? [])]);

        if (permissionUpdate) options.permissions.applyCommittedUpdate(permissionUpdate);
        if (selectionUpdate) options.dappConnections.applyCommittedUpdate(selectionUpdate);
        options.dappConnections.refreshActiveConnectionStates(selectionUpdate?.changedScopes);
      }

      options.approvals.cancel(
        options.approvals
          .list()
          .filter((approval) => approval.origin === origin)
          .map((approval) => approval.approvalId),
      );

      if (permissionUpdate) options.publishPermissionsChanged(permissionsChangedFromUpdate(permissionUpdate));
    });
  };

  const closeConnection = (scope: DappConnectionScope): void => {
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
    closeConnection,
  };
};
