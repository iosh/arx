import { Dexie, type Table } from "dexie";
import type {
  AccountRow,
  AccountSelectionRow,
  ChainRpcOverrideRow,
  CustomChainRow,
  EncryptedVaultRow,
  HdKeyringRow,
  KeySourceRow,
  PermissionRow,
  ProviderChainSelectionRow,
  SettingRow,
  TransactionRow,
  WalletChainSelectionRow,
} from "./rows.js";

export const PERSISTENCE_SCHEMA_VERSION = 1;

const TRANSACTIONS_SCHEMA =
  "&transactionId, [createAt+transactionId], [chainRef+createAt+transactionId], [accountId+createAt+transactionId], status, [chainRef+conflictKey.kind+conflictKey.value]";

export class ArxPersistenceDatabase extends Dexie {
  encryptedVault!: Table<EncryptedVaultRow, string>;
  settings!: Table<SettingRow, string>;
  keySources!: Table<KeySourceRow, string>;
  hdKeyrings!: Table<HdKeyringRow, string>;
  accounts!: Table<AccountRow, string>;
  accountSelections!: Table<AccountSelectionRow, string>;
  permissions!: Table<PermissionRow, [string, string]>;
  customChains!: Table<CustomChainRow, string>;
  chainRpcOverrides!: Table<ChainRpcOverrideRow, string>;
  walletChainSelection!: Table<WalletChainSelectionRow, string>;
  providerChainSelections!: Table<ProviderChainSelectionRow, [string, string]>;
  transactions!: Table<TransactionRow, string>;

  constructor(databaseName: string) {
    super(databaseName);
    this.version(PERSISTENCE_SCHEMA_VERSION).stores({
      encryptedVault: "&key",
      settings: "&key",
      keySources: "&keySourceId",
      hdKeyrings: "&keyringId, keySourceId, namespace",
      accounts: "&accountId, namespace, hdKeyringId, privateKeySourceId",
      accountSelections: "&namespace",
      permissions: "[origin+namespace], origin, *indexedAccountIds, *indexedChainRefs",
      customChains: "&definition.chainRef",
      chainRpcOverrides: "&chainRef",
      walletChainSelection: "&key",
      providerChainSelections: "[origin+namespace], origin, chainRef",
      transactions: TRANSACTIONS_SCHEMA,
    });
  }
}

export type DexiePersistenceContext = Readonly<{
  db: ArxPersistenceDatabase;
  ready: ReturnType<ArxPersistenceDatabase["open"]>;
}>;

export const createDexiePersistenceContext = (databaseName: string): DexiePersistenceContext => {
  const db = new ArxPersistenceDatabase(databaseName);
  return {
    db,
    ready: db.open(),
  };
};
