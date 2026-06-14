import type {
  AccountRecord,
  ChainRpcEndpointOverrideRecord,
  CustomChainRecord,
  KeyringMetaRecord,
  PermissionRecord,
  ProviderChainSelectionRecord,
  SettingsRecord,
  WalletChainSelectionRecord,
} from "@arx/core/storage";
import type {
  TransactionRecord as AggregateTransactionRecord,
  TransactionSubmission,
} from "@arx/core/transactions/storage";
import { Dexie, type Table } from "dexie";
import type { VaultMetaEntity } from "./types.js";

export const DB_SCHEMA_VERSION = 1;

const TRANSACTION_RECORDS_SCHEMA =
  "&id, namespace, chainRef, accountKey, status, createdAt, updatedAt, [createdAt+id], [chainRef+createdAt+id], [accountKey+createdAt+id], [status+createdAt+id], [namespace+chainRef+accountKey+createdAt+id], [conflictKey.kind+conflictKey.value]";
const TRANSACTION_SUBMISSIONS_SCHEMA =
  "&id, transactionId, status, createdAt, updatedAt, [transactionId+id], [transactionId+createdAt], [transactionId+status], [status+updatedAt]";

type CustomChainRow = CustomChainRecord;
type ChainRpcEndpointOverridesRow = ChainRpcEndpointOverrideRecord;
type KeyringMetaRow = KeyringMetaRecord;

export class ArxStorageDatabase extends Dexie {
  settings!: Table<SettingsRecord, string>;
  customChains!: Table<CustomChainRow, string>;
  chainRpcEndpointOverrides!: Table<ChainRpcEndpointOverridesRow, string>;
  walletChainSelection!: Table<WalletChainSelectionRecord, string>;
  providerChainSelection!: Table<ProviderChainSelectionRecord, [string, string]>;
  accounts!: Table<AccountRecord, string>;
  permissions!: Table<PermissionRecord, [string, string]>;
  transactionRecords!: Table<AggregateTransactionRecord, string>;
  transactionSubmissions!: Table<TransactionSubmission, string>;

  vaultMeta!: Table<VaultMetaEntity, string>;

  keyringMetas!: Table<KeyringMetaRow, string>;

  constructor(name: string) {
    super(name);
    this.version(DB_SCHEMA_VERSION).stores({
      settings: "&id",
      customChains: "&chainRef, namespace, updatedAt",
      chainRpcEndpointOverrides: "&chainRef, updatedAt",
      walletChainSelection: "&id",
      providerChainSelection: "[origin+namespace]",
      accounts: "&accountKey, namespace, keyringId",
      permissions: "[origin+namespace], origin",
      transactionRecords: TRANSACTION_RECORDS_SCHEMA,
      transactionSubmissions: TRANSACTION_SUBMISSIONS_SCHEMA,

      vaultMeta: "&id",

      keyringMetas: "&id, type, createdAt",
    });
  }
}
