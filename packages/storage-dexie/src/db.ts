import type {
  AccountRecord,
  ChainDefinitionEntity,
  KeyringMetaRecord,
  NetworkPreferencesRecord,
  PermissionRecord,
  SettingsRecord,
  TransactionRecord,
} from "@arx/core/storage";
import { Dexie, type Table } from "dexie";
import type { VaultMetaEntity } from "./types.js";

export const DB_SCHEMA_VERSION = 1;

type ChainDefinitionsRow = ChainDefinitionEntity;
type KeyringMetaRow = KeyringMetaRecord;

export class ArxStorageDatabase extends Dexie {
  settings!: Table<SettingsRecord, string>;
  chains!: Table<ChainDefinitionsRow, string>;
  networkPreferences!: Table<NetworkPreferencesRecord, string>;
  accounts!: Table<AccountRecord, string>;
  permissions!: Table<PermissionRecord, [string, string]>;
  transactions!: Table<TransactionRecord, string>;

  vaultMeta!: Table<VaultMetaEntity, string>;

  keyringMetas!: Table<KeyringMetaRow, string>;

  constructor(name: string) {
    super(name);
    this.version(DB_SCHEMA_VERSION).stores({
      settings: "&id",
      chains: "&chainRef",
      networkPreferences: "&id",
      accounts: "&accountKey, namespace, keyringId",
      permissions: "[origin+namespace], origin",
      transactions:
        "&id, status, chainRef, hash, createdAt, updatedAt, [chainRef+createdAt], [status+createdAt], [chainRef+hash]",

      vaultMeta: "&id",

      keyringMetas: "&id, type, createdAt",
    });
  }
}
