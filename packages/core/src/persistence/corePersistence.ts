import type { AccountsReader } from "../accounts/persistence.js";
import type { DappNetworkSelectionsReader } from "../dappConnections/persistence.js";
import type { HdKeyringsReader, KeySourcesReader } from "../keyring/persistence.js";
import type {
  CustomNetworksReader,
  NetworkRpcOverridesReader,
  NetworkSelectionReader,
} from "../networks/persistence.js";
import type { PermissionRecordsReader } from "../permissions/persistence.js";
import type { SettingsReader } from "../settings/persistence.js";
import type { TransactionsReader } from "../transactions/persistence.js";
import type { EncryptedVaultReader } from "../vault/persistence.js";
import type { PersistenceChange } from "./persistenceTypes.js";

export interface PersistenceWriter {
  /** Commits one complete set of canonical record changes atomically. */
  commit(changes: readonly PersistenceChange[]): Promise<void>;
}

export interface CorePersistenceReaders {
  encryptedVault: EncryptedVaultReader;
  settings: SettingsReader;
  keySources: KeySourcesReader;
  hdKeyrings: HdKeyringsReader;
  accounts: AccountsReader;
  permissions: PermissionRecordsReader;
  customNetworks: CustomNetworksReader;
  networkRpcOverrides: NetworkRpcOverridesReader;
  networkSelection: NetworkSelectionReader;
  dappNetworkSelections: DappNetworkSelectionsReader;
  transactions: TransactionsReader;
}

/** Complete persistence dependency supplied to one core runtime. */
export interface CorePersistence {
  readers: CorePersistenceReaders;
  writer: PersistenceWriter;
}
