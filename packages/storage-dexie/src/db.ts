import type {
  AccountRecord,
  CustomChainRecord,
  CustomRpcRecord,
  KeyringMetaRecord,
  NetworkSelectionRecord,
  PermissionRecord,
  SettingsRecord,
  TransactionRecord,
} from "@arx/core/storage";
import type {
  TransactionRecord as AggregateTransactionRecord,
  TransactionSubmission,
} from "@arx/core/transactions/storage";
import { Dexie, type Table } from "dexie";
import type { VaultMetaEntity } from "./types.js";

export const DB_SCHEMA_VERSION = 1;

const TRANSACTIONS_SCHEMA =
  "&id, status, chainRef, createdAt, updatedAt, [createdAt+id], [chainRef+createdAt], [chainRef+createdAt+id], [status+createdAt], [status+createdAt+id], [replacementKey.scope+replacementKey.value]";
const TRANSACTION_RECORDS_SCHEMA =
  "&id, namespace, chainRef, accountKey, status, createdAt, updatedAt, [createdAt+id], [chainRef+createdAt+id], [accountKey+createdAt+id], [status+createdAt+id], [namespace+chainRef+accountKey+createdAt+id], [conflictKey.kind+conflictKey.value]";
const TRANSACTION_SUBMISSIONS_SCHEMA =
  "&id, transactionId, status, createdAt, updatedAt, [transactionId+id], [transactionId+createdAt], [transactionId+status], [status+updatedAt]";

type CustomChainRow = CustomChainRecord;
type CustomRpcRow = CustomRpcRecord;
type KeyringMetaRow = KeyringMetaRecord;

export class ArxStorageDatabase extends Dexie {
  settings!: Table<SettingsRecord, string>;
  customChains!: Table<CustomChainRow, string>;
  customRpc!: Table<CustomRpcRow, string>;
  networkSelection!: Table<NetworkSelectionRecord, string>;
  accounts!: Table<AccountRecord, string>;
  permissions!: Table<PermissionRecord, [string, string]>;
  transactions!: Table<TransactionRecord, string>;
  transactionRecords!: Table<AggregateTransactionRecord, string>;
  transactionSubmissions!: Table<TransactionSubmission, string>;

  vaultMeta!: Table<VaultMetaEntity, string>;

  keyringMetas!: Table<KeyringMetaRow, string>;

  constructor(name: string) {
    super(name);
    this.version(DB_SCHEMA_VERSION).stores({
      settings: "&id",
      customChains: "&chainRef, namespace, updatedAt",
      customRpc: "&chainRef, updatedAt",
      networkSelection: "&id",
      accounts: "&accountKey, namespace, keyringId",
      permissions: "[origin+namespace], origin",
      transactions: TRANSACTIONS_SCHEMA,
      transactionRecords: TRANSACTION_RECORDS_SCHEMA,
      transactionSubmissions: TRANSACTION_SUBMISSIONS_SCHEMA,

      vaultMeta: "&id",

      keyringMetas: "&id, type, createdAt",
    });
  }
}
