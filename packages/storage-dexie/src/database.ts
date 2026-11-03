import { PersistenceCommitError, PersistenceReadError } from "@arx/core/persistence";
import { Dexie, type Table } from "dexie";
import type {
  AccountGroupRow,
  AccountRow,
  AccountSelectionRow,
  CustomNetworkRow,
  DappNetworkSelectionRow,
  EncryptedVaultRow,
  HdKeyringRow,
  KeySourceRow,
  NetworkRpcOverrideRow,
  PermissionRow,
  SettingsRow,
  TransactionRow,
} from "./rows.js";

export const PERSISTENCE_SCHEMA_VERSION = 1;

const TRANSACTIONS_SCHEMA =
  "&transactionId, [createdAt+transactionId], [chainRef+createdAt+transactionId], [accountId+createdAt+transactionId], state.status";

export class ArxPersistenceDatabase extends Dexie {
  encryptedVault!: Table<EncryptedVaultRow, string>;
  settings!: Table<SettingsRow, string>;
  keySources!: Table<KeySourceRow, string>;
  hdKeyrings!: Table<HdKeyringRow, string>;
  accounts!: Table<AccountRow, string>;
  accountGroups!: Table<AccountGroupRow, string>;
  accountSelection!: Table<AccountSelectionRow, string>;
  permissions!: Table<PermissionRow, [string, string]>;
  customNetworks!: Table<CustomNetworkRow, string>;
  networkRpcOverrides!: Table<NetworkRpcOverrideRow, string>;
  dappNetworkSelections!: Table<DappNetworkSelectionRow, [string, string]>;
  transactions!: Table<TransactionRow, string>;

  constructor(databaseName: string) {
    super(databaseName);
    this.version(PERSISTENCE_SCHEMA_VERSION).stores({
      encryptedVault: "&key",
      settings: "&key",
      keySources: "&keySourceId",
      hdKeyrings: "&hdKeyringId",
      accounts: "&accountId",
      accountGroups: "&accountGroupId",
      accountSelection: "&key",
      permissions: "[origin+namespace]",
      customNetworks: "&definition.chainRef",
      networkRpcOverrides: "&chainRef",
      dappNetworkSelections: "[origin+namespace]",
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
    if (error instanceof PersistenceReadError) throw error;
    throw new PersistenceReadError(error);
  }
};

const commit = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PersistenceReadError) throw error;
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
