import type { ChainRegistryPort } from "@arx/core/chains";
import type {
  AccountRecord,
  ApprovalRecord,
  ChainRecord,
  PermissionRecord,
  SettingsRecord,
  TransactionRecord,
} from "@arx/core/db";
import {
  type AccountMeta,
  AccountMetaSchema,
  type ChainRegistryEntity,
  ChainRegistryEntitySchema,
  DOMAIN_SCHEMA_VERSION,
  type KeyringMeta,
  KeyringMetaSchema,
  type KeyringStorePort,
  type StorageNamespace,
  StorageNamespaces,
  type StoragePort,
  type StorageSnapshotMap,
  type StorageSnapshotSchemaMap,
  StorageSnapshotSchemas,
  VAULT_META_SNAPSHOT_VERSION,
  type VaultMetaSnapshot,
  VaultMetaSnapshotSchema,
} from "@arx/core/storage";
import { Dexie, type PromiseExtended, type Table } from "dexie";
import { runMigrations } from "./migrations.js";

type ChainRegistryRow = ChainRegistryEntity;
const DEFAULT_DB_NAME = "arx-storage";
type SnapshotEntity = {
  namespace: StorageNamespace;
  envelope: unknown;
};

type VaultMetaEntity = {
  id: "vault-meta";
  version: number;
  updatedAt: number;
  payload: unknown;
};

const databaseRegistry = new Map<string, ArxStorageDatabase>();

const getOrCreateDatabase = (dbName: string): ArxStorageDatabase => {
  const cached = databaseRegistry.get(dbName);
  if (cached) {
    return cached;
  }

  const db = new ArxStorageDatabase(dbName);
  databaseRegistry.set(dbName, db);

  db.on("close", () => {
    if (databaseRegistry.get(dbName) === db) {
      databaseRegistry.delete(dbName);
    }
  });

  return db;
};

type KeyringMetaRow = KeyringMeta;
type AccountMetaRow = AccountMeta;

class ArxStorageDatabase extends Dexie {
  snapshots!: Table<SnapshotEntity, StorageNamespace>;

  settings!: Table<SettingsRecord, string>;
  chains!: Table<ChainRegistryRow, string>;
  accounts!: Table<AccountRecord, string>;
  permissions!: Table<PermissionRecord, string>;
  approvals!: Table<ApprovalRecord, string>;
  transactions!: Table<TransactionRecord, string>;

  vaultMeta!: Table<VaultMetaEntity, string>;

  keyringMetas!: Table<KeyringMetaRow, string>;
  accountMetas!: Table<AccountMetaRow, string>;
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
        accountMetas: "&address, keyringId, createdAt, [keyringId+hidden]",
      })
      .upgrade((transaction) => {
        return runMigrations({ db: this, transaction });
      });
  }
}

class DexieStoragePort implements StoragePort {
  private readonly ready: PromiseExtended<Dexie>;

  constructor(private readonly db: ArxStorageDatabase) {
    this.ready = this.db.open();
  }

  async loadSnapshot<TNamespace extends StorageNamespace>(
    namespace: TNamespace,
  ): Promise<StorageSnapshotMap[TNamespace] | null> {
    await this.ready;

    const table = this.getTable(namespace);
    const entity = await table.get(namespace);

    if (!entity) {
      return null;
    }

    const schema = StorageSnapshotSchemas[namespace] as StorageSnapshotSchemaMap[TNamespace];

    const parsed = schema.safeParse(entity.envelope);

    if (!parsed.success) {
      console.warn(`[storage-dexie] invalid snapshot detected for ${namespace}`, parsed.error);
      await table.delete(namespace);
      return null;
    }

    return parsed.data as StorageSnapshotMap[TNamespace];
  }

  async saveSnapshot<TNamespace extends StorageNamespace>(
    namespace: TNamespace,
    envelope: StorageSnapshotMap[TNamespace],
  ): Promise<void> {
    await this.ready;
    const table = this.getTable(namespace);
    const schema = StorageSnapshotSchemas[namespace];
    const checked = schema.parse(envelope);
    await table.put({ namespace, envelope: checked });
  }

  async clearSnapshot(namespace: StorageNamespace): Promise<void> {
    await this.ready;
    const table = this.getTable(namespace);
    await table.delete(namespace);
  }

  async loadVaultMeta(): Promise<VaultMetaSnapshot | null> {
    await this.ready;
    const entity = await this.db.vaultMeta.get("vault-meta");
    if (!entity) {
      return null;
    }

    const parsed = VaultMetaSnapshotSchema.safeParse(entity.payload);

    if (!parsed.success) {
      console.warn("[storage-dexie] invalid vault meta detected", parsed.error);
      await this.db.vaultMeta.delete("vault-meta");
      return null;
    }

    return parsed.data;
  }

  async saveVaultMeta(envelope: VaultMetaSnapshot): Promise<void> {
    await this.ready;
    const checked = VaultMetaSnapshotSchema.parse(envelope);
    await this.db.vaultMeta.put({
      id: "vault-meta",
      version: VAULT_META_SNAPSHOT_VERSION,
      updatedAt: checked.updatedAt,
      payload: checked,
    });
  }
  async clearVaultMeta(): Promise<void> {
    await this.ready;
    await this.db.vaultMeta.delete("vault-meta");
  }

  private getTable(namespace: StorageNamespace) {
    switch (namespace) {
      case StorageNamespaces.Network:
      case StorageNamespaces.Accounts:
      case StorageNamespaces.Permissions:
      case StorageNamespaces.Approvals:
      case StorageNamespaces.Transactions:
        return this.db.snapshots;
      default:
        throw new Error(`Unknown storage namespace: ${namespace}`);
    }
  }
}

class DexieChainRegistryPort implements ChainRegistryPort {
  private readonly ready: PromiseExtended<Dexie>;
  private readonly table: Table<ChainRegistryRow, string>;

  constructor(private readonly db: ArxStorageDatabase) {
    this.ready = this.db.open();
    this.table = this.db.chains;
  }

  async get(chainRef: ChainRegistryRow["chainRef"]): Promise<ChainRegistryEntity | null> {
    await this.ready;
    const row = await this.table.get(chainRef);
    return this.parseRow(row);
  }

  async getAll(): Promise<ChainRegistryEntity[]> {
    await this.ready;
    const rows = await this.table.toArray();
    const entities: ChainRegistryEntity[] = [];
    for (const row of rows) {
      const parsed = await this.parseRow(row);
      if (parsed) {
        entities.push(parsed);
      }
    }
    return entities;
  }

  async put(entity: ChainRegistryEntity): Promise<void> {
    await this.ready;
    const checked = ChainRegistryEntitySchema.parse(entity);
    await this.table.put(checked);
  }

  async putMany(entities: ChainRegistryEntity[]): Promise<void> {
    await this.ready;
    const checked = entities.map((entity) => ChainRegistryEntitySchema.parse(entity));
    await this.table.bulkPut(checked);
  }

  async delete(chainRef: ChainRegistryRow["chainRef"]): Promise<void> {
    await this.ready;
    await this.table.delete(chainRef);
  }

  async clear(): Promise<void> {
    await this.ready;
    await this.table.clear();
  }

  private async parseRow(row: ChainRegistryRow | undefined): Promise<ChainRegistryEntity | null> {
    if (!row) {
      return null;
    }
    const parsed = ChainRegistryEntitySchema.safeParse(row);
    if (!parsed.success) {
      console.warn("[storage-dexie] invalid chain registry entry detected", parsed.error);
      await this.table.delete(row.chainRef);
      return null;
    }
    return parsed.data;
  }
}

class DexieKeyringStorePort implements KeyringStorePort {
  private readonly ready: PromiseExtended<Dexie>;
  constructor(private readonly db: ArxStorageDatabase) {
    this.ready = this.db.open();
  }

  async getKeyringMetas(): Promise<KeyringMeta[]> {
    await this.ready;
    const rows = await this.db.keyringMetas.toArray();
    const result: KeyringMeta[] = [];
    for (const row of rows) {
      const parsed = KeyringMetaSchema.safeParse(row);
      if (parsed.success) {
        result.push(parsed.data);
      } else {
        console.warn("[storage-dexie] invalid keyring meta, dropping", parsed.error);
        await this.db.keyringMetas.delete(row.id);
      }
    }
    return result;
  }

  async getAccountMetas(): Promise<AccountMeta[]> {
    await this.ready;
    const rows = await this.db.accountMetas.toArray();
    const result: AccountMeta[] = [];
    for (const row of rows) {
      const parsed = AccountMetaSchema.safeParse(row);
      if (parsed.success) {
        result.push(parsed.data);
      } else {
        console.warn("[storage-dexie] invalid account meta, dropping", parsed.error);
        await this.db.accountMetas.delete(row.address);
      }
    }
    return result;
  }

  async putKeyringMetas(metas: KeyringMeta[]): Promise<void> {
    await this.ready;
    const checked = metas.map((meta) => KeyringMetaSchema.parse(meta));
    await this.db.keyringMetas.bulkPut(checked);
  }

  async putAccountMetas(metas: AccountMeta[]): Promise<void> {
    await this.ready;
    const checked = metas.map((meta) => AccountMetaSchema.parse(meta));
    await this.db.accountMetas.bulkPut(checked);
  }

  async deleteKeyringMeta(id: string): Promise<void> {
    await this.ready;
    await this.db.transaction("rw", this.db.keyringMetas, this.db.accountMetas, async () => {
      await this.db.keyringMetas.delete(id);
      await this.db.accountMetas.where("keyringId").equals(id).delete();
    });
  }

  async deleteAccount(address: string): Promise<void> {
    await this.ready;
    await this.db.accountMetas.delete(address);
  }

  async deleteAccountsByKeyring(keyringId: string): Promise<void> {
    await this.ready;
    await this.db.accountMetas.where("keyringId").equals(keyringId).delete();
  }
}

export type CreateDexieKeyringStoreOptions = { databaseName?: string };

export const createDexieKeyringStore = (options: CreateDexieKeyringStoreOptions = {}): KeyringStorePort => {
  const dbName = options.databaseName ?? DEFAULT_DB_NAME;
  const db = getOrCreateDatabase(dbName);
  return new DexieKeyringStorePort(db);
};

export type CreateDexieChainRegistryPortOptions = {
  databaseName?: string;
};

export const createDexieChainRegistryPort = (options: CreateDexieChainRegistryPortOptions = {}): ChainRegistryPort => {
  const dbName = options.databaseName ?? DEFAULT_DB_NAME;
  const db = getOrCreateDatabase(dbName);
  return new DexieChainRegistryPort(db);
};

export type CreateDexieStorageOptions = {
  databaseName?: string;
};

export const createDexieStorage = (options: CreateDexieStorageOptions = {}): StoragePort => {
  const dbName = options.databaseName ?? DEFAULT_DB_NAME;
  const db = getOrCreateDatabase(dbName);
  return new DexieStoragePort(db);
};
