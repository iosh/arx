import type { DappNetworkSelectionRecord } from "../dappConnections/persistence.js";
import { dappConnectionScopeKey } from "../dappConnections/scope.js";
import { PermissionNetworkSelectionMissingError } from "../permissions/errors.js";
import type { PermissionRecord } from "../permissions/persistence.js";

export const assertPersistedPermissionSelectionIntegrity = (input: {
  permissions: readonly PermissionRecord[];
  networkSelections: readonly DappNetworkSelectionRecord[];
}): void => {
  const networkSelectionScopes = new Set(input.networkSelections.map(dappConnectionScopeKey));

  for (const permission of input.permissions) {
    if (!networkSelectionScopes.has(dappConnectionScopeKey(permission))) {
      throw new PermissionNetworkSelectionMissingError({
        origin: permission.origin,
        namespace: permission.namespace,
      });
    }
  }
};
