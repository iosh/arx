import type { AccountsReader } from "../accounts/persistence.js";
import type { CustomChainsReader } from "../chains/definitions/persistence.js";
import type { ChainRpcOverridesReader } from "../chains/rpc/endpointOverrides/persistence.js";
import type { ProviderChainSelectionsReader } from "../chains/selection/provider/persistence.js";
import type { WalletChainSelectionReader } from "../chains/selection/wallet/persistence.js";
import type { HdKeyringsReader, KeySourcesReader } from "../keyring/persistence.js";
import type { PermissionsReader } from "../permissions/persistence.js";
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
  permissions: PermissionsReader;
  customChains: CustomChainsReader;
  chainRpcOverrides: ChainRpcOverridesReader;
  walletChainSelection: WalletChainSelectionReader;
  providerChainSelections: ProviderChainSelectionsReader;
  transactions: TransactionsReader;
}

/** Complete persistence dependency supplied to one core runtime. */
export interface CorePersistence {
  readers: CorePersistenceReaders;
  writer: PersistenceWriter;
}
