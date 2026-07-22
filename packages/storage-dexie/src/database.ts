import { isArxBaseError } from "@arx/core";
import { PersistenceCommitError, PersistenceReadError } from "@arx/core/persistence";
import { Dexie, type Table } from "dexie";
import type {
  AccountRow,
  AccountSelectionRow,
  CustomNetworkRow,
  DappNetworkSelectionRow,
  EncryptedVaultRow,
  HdKeyringRow,
  KeySourceRow,
  NetworkRpcOverrideRow,
  NetworkSelectionRow,
  PermissionRow,
  SettingsRow,
  TransactionRow,
} from "./rows.js";

export const PERSISTENCE_SCHEMA_VERSION = 2;

const TRANSACTIONS_SCHEMA =
  "&transactionId, [createdAt+transactionId], [chainRef+createdAt+transactionId], [accountId+createdAt+transactionId], state.status";

export class ArxPersistenceDatabase extends Dexie {
  encryptedVault!: Table<EncryptedVaultRow, string>;
  settings!: Table<SettingsRow, string>;
  keySources!: Table<KeySourceRow, string>;
  hdKeyrings!: Table<HdKeyringRow, string>;
  accounts!: Table<AccountRow, string>;
  accountSelections!: Table<AccountSelectionRow, string>;
  permissions!: Table<PermissionRow, [string, string]>;
  customNetworks!: Table<CustomNetworkRow, string>;
  networkRpcOverrides!: Table<NetworkRpcOverrideRow, string>;
  networkSelection!: Table<NetworkSelectionRow, string>;
  dappNetworkSelections!: Table<DappNetworkSelectionRow, [string, string]>;
  transactions!: Table<TransactionRow, string>;

  constructor(databaseName: string) {
    super(databaseName);
    this.version(PERSISTENCE_SCHEMA_VERSION)
      .stores({
        encryptedVault: "&key",
        settings: "&key",
        keySources: "&keySourceId",
        hdKeyrings: "&hdKeyringId",
        accounts: "&accountId",
        accountSelections: "&namespace",
        permissions: "[origin+namespace]",
        customNetworks: "&definition.chainRef",
        networkRpcOverrides: "&chainRef",
        networkSelection: "&key",
        dappNetworkSelections: "[origin+namespace]",
        transactions: TRANSACTIONS_SCHEMA,
      })
      .upgrade(async (transaction) => {
        // The target record has no valid representation for the legacy transaction row.
        await transaction.table("transactions").clear();
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
