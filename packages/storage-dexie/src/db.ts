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
import { Dexie, type Table } from "dexie";
import type { VaultMetaEntity } from "./types.js";

export const DB_SCHEMA_VERSION = 2;

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
      transactions:
        "&id, status, chainRef, hash, createdAt, updatedAt, [createdAt+id], [chainRef+createdAt], [chainRef+createdAt+id], [status+createdAt], [status+createdAt+id], [chainRef+hash]",

      vaultMeta: "&id",

      keyringMetas: "&id, type, createdAt",
    });
  }
}
