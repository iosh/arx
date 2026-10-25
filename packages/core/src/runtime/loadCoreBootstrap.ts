import { type AccountsBootstrap, loadAccountsBootstrap } from "../accounts/bootstrap.js";
import { type DappConnectionsBootstrap, loadDappConnectionsBootstrap } from "../dappConnections/bootstrap.js";
import { type KeyringBootstrap, loadKeyringBootstrap } from "../keyring/bootstrap.js";
import { loadNetworksBootstrap, type NetworksBootstrap } from "../networks/bootstrap.js";
import { loadPermissionsBootstrap, type PermissionsBootstrap } from "../permissions/bootstrap.js";
import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import { loadTransactionsBootstrap, type TransactionsBootstrap } from "../transactions/transactionBootstrap.js";
import { loadWalletBootstrap, type WalletBootstrap } from "../wallet/bootstrap.js";

type CoreBootstrap = Readonly<{
  wallet: WalletBootstrap;
  keyring: KeyringBootstrap;
  accounts: AccountsBootstrap;
  networks: NetworksBootstrap;
  dappConnections: DappConnectionsBootstrap;
  permissions: PermissionsBootstrap;
  transactions: TransactionsBootstrap;
}>;

export const loadCoreBootstrap = async (readers: CorePersistenceReaders): Promise<CoreBootstrap> => {
  const [wallet, keyring, accounts, networks, dappConnections, permissions, transactions] = await Promise.all([
    loadWalletBootstrap(readers),
    loadKeyringBootstrap(readers),
    loadAccountsBootstrap(readers),
    loadNetworksBootstrap(readers),
    loadDappConnectionsBootstrap(readers),
    loadPermissionsBootstrap(readers),
    loadTransactionsBootstrap(readers),
  ]);

  return {
    wallet,
    keyring,
    accounts,
    networks,
    dappConnections,
    permissions,
    transactions,
  };
};
