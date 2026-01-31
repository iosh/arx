import type {
  AccountRecord,
  ApprovalRecord,
  KeyringMetaRecord,
  PermissionRecord,
  SettingsRecord,
  TransactionRecord,
} from "@arx/core/db";
import { type ChainRegistryEntity, DOMAIN_SCHEMA_VERSION, type StorageNamespace } from "@arx/core/storage";
import { Dexie, type Table } from "dexie";
import { runMigrations } from "./migrations.js";
import type { SnapshotEntity, VaultMetaEntity } from "./types.js";

type ChainRegistryRow = ChainRegistryEntity;
type KeyringMetaRow = KeyringMetaRecord;

export class ArxStorageDatabase extends Dexie {
  snapshots!: Table<SnapshotEntity, StorageNamespace>;

  settings!: Table<SettingsRecord, string>;
  chains!: Table<ChainRegistryRow, string>;
  accounts!: Table<AccountRecord, string>;
  permissions!: Table<PermissionRecord, string>;
  approvals!: Table<ApprovalRecord, string>;
  transactions!: Table<TransactionRecord, string>;

  vaultMeta!: Table<VaultMetaEntity, string>;

  keyringMetas!: Table<KeyringMetaRow, string>;

  constructor(name: string) {
    super(name);
    this.version(DOMAIN_SCHEMA_VERSION)
      .stores({
        snapshots: "&namespace",

        settings: "&id",
        chains: "&chainRef",
        accounts: "&accountId, namespace, keyringId",
        permissions: "&id, origin, &[origin+namespace+chainRef]",
        approvals: "&id, status, type, origin, createdAt",
        transactions: "&id, status, chainRef, hash, createdAt, updatedAt, [chainRef+createdAt], [status+createdAt]",

        vaultMeta: "&id",

        keyringMetas: "&id, type, createdAt",
      })
      .upgrade((transaction) => {
        return runMigrations({ db: this, transaction });
      });
  }
}
