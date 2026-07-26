import { type AccountsBootstrap, loadAccountsBootstrap } from "../accounts/bootstrap.js";
import { type DappConnectionsBootstrap, loadDappConnectionsBootstrap } from "../dappConnections/bootstrap.js";
import { dappConnectionScopeKey } from "../dappConnections/scope.js";
import { type KeyringBootstrap, loadKeyringBootstrap } from "../keyring/bootstrap.js";
import { loadNetworksBootstrap, type NetworksBootstrap } from "../networks/bootstrap.js";
import { loadPermissionsBootstrap, type PermissionsBootstrap } from "../permissions/bootstrap.js";
import { PermissionNetworkSelectionMissingError } from "../permissions/errors.js";
import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import { loadTransactionsBootstrap, type TransactionsBootstrap } from "../transactions/transactionBootstrap.js";
import { loadVaultBootstrap, type VaultBootstrap } from "../vault/bootstrap.js";
import { loadWalletBootstrap, type WalletBootstrap } from "../wallet/bootstrap.js";

type CoreBootstrap = Readonly<{
  vault: VaultBootstrap;
  wallet: WalletBootstrap;
  keyring: KeyringBootstrap;
  accounts: AccountsBootstrap;
  networks: NetworksBootstrap;
  dappConnections: DappConnectionsBootstrap;
  permissions: PermissionsBootstrap;
  transactions: TransactionsBootstrap;
}>;

const assertPermissionsHaveNetworkSelections = (
  permissions: PermissionsBootstrap,
  dappConnections: DappConnectionsBootstrap,
): void => {
  const networkSelectionScopes = new Set(dappConnections.networkSelections.map(dappConnectionScopeKey));

  for (const permission of permissions.records) {
    if (networkSelectionScopes.has(dappConnectionScopeKey(permission))) continue;

    throw new PermissionNetworkSelectionMissingError({
      origin: permission.origin,
      namespace: permission.namespace,
    });
  }
};

export const loadCoreBootstrap = async (readers: CorePersistenceReaders): Promise<CoreBootstrap> => {
  const [vault, wallet, keyring, accounts, networks, dappConnections, permissions, transactions] = await Promise.all([
    loadVaultBootstrap(readers),
    loadWalletBootstrap(readers),
    loadKeyringBootstrap(readers),
    loadAccountsBootstrap(readers),
    loadNetworksBootstrap(readers),
    loadDappConnectionsBootstrap(readers),
    loadPermissionsBootstrap(readers),
    loadTransactionsBootstrap(readers),
  ]);

  assertPermissionsHaveNetworkSelections(permissions, dappConnections);

  return {
    vault,
    wallet,
    keyring,
    accounts,
    networks,
    dappConnections,
    permissions,
    transactions,
  };
};
