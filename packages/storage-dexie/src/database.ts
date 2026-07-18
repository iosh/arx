import { isArxBaseError } from "@arx/core";
import { PersistenceCommitError, PersistenceReadError } from "@arx/core/persistence";
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
      hdKeyrings: "&hdKeyringId",
      accounts: "&accountId",
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
  ready: Promise<void>;
  read<T>(operation: () => Promise<T>): Promise<T>;
  commit<T>(operation: () => Promise<T>): Promise<T>;
}>;

const read = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (isArxBaseError(error)) throw error;
    throw new PersistenceReadError(error);
  }
};

const commit = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (isArxBaseError(error)) throw error;
    throw new PersistenceCommitError(error);
  }
};

export const createDexiePersistenceContext = (databaseName: string): DexiePersistenceContext => {
  const db = new ArxPersistenceDatabase(databaseName);
  return {
    db,
    ready: read(async () => {
      await db.open();
    }),
    read,
    commit,
  };
};
