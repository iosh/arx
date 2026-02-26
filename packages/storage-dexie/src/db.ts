import type {
  AccountRecord,
  KeyringMetaRecord,
  NetworkPreferencesRecord,
  PermissionRecord,
  SettingsRecord,
  TransactionRecord,
} from "@arx/core/storage";
import { type ChainRegistryEntity, DOMAIN_SCHEMA_VERSION } from "@arx/core/storage";
import { Dexie, type Table } from "dexie";
import type { VaultMetaEntity } from "./types.js";

type ChainRegistryRow = ChainRegistryEntity;
type KeyringMetaRow = KeyringMetaRecord;

export class ArxStorageDatabase extends Dexie {
  settings!: Table<SettingsRecord, string>;
  chains!: Table<ChainRegistryRow, string>;
  networkPreferences!: Table<NetworkPreferencesRecord, string>;
  accounts!: Table<AccountRecord, string>;
  permissions!: Table<PermissionRecord, [string, string]>;
  transactions!: Table<TransactionRecord, string>;

  vaultMeta!: Table<VaultMetaEntity, string>;

  keyringMetas!: Table<KeyringMetaRow, string>;

  constructor(name: string) {
    super(name);
    this.version(DOMAIN_SCHEMA_VERSION).stores({
      settings: "&id",
      chains: "&chainRef",
      networkPreferences: "&id",
      accounts: "&accountId, namespace, keyringId",
      permissions: "[origin+namespace], origin",
      transactions: "&id, status, chainRef, hash, createdAt, updatedAt, [chainRef+createdAt], [status+createdAt]",

      vaultMeta: "&id",

      keyringMetas: "&id, type, createdAt",
    });
  }
}
