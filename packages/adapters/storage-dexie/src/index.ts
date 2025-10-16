import type { ChainRegistryPort } from "@arx/core/chains";
import {
  type ChainRegistryEntity,
  ChainRegistryEntitySchema,
  DOMAIN_SCHEMA_VERSION,
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

class ArxStorageDatabase extends Dexie {
  chains!: Table<SnapshotEntity, StorageNamespace>;
  accounts!: Table<SnapshotEntity, StorageNamespace>;
  permissions!: Table<SnapshotEntity, StorageNamespace>;
  approvals!: Table<SnapshotEntity, StorageNamespace>;
  transactions!: Table<SnapshotEntity, StorageNamespace>;
  vaultMeta!: Table<VaultMetaEntity, string>;
  chainRegistry!: Table<ChainRegistryRow, string>;

  constructor(name: string) {
    super(name);
    this.version(DOMAIN_SCHEMA_VERSION)
      .stores({
        chains: "&namespace",
        accounts: "&namespace",
        permissions: "&namespace",
        approvals: "&namespace",
        transactions: "&namespace",
        vaultMeta: "&id",
        chainRegistry: "&chainRef",
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
        return this.db.chains;
      case StorageNamespaces.Accounts:
        return this.db.accounts;
      case StorageNamespaces.Permissions:
        return this.db.permissions;
      case StorageNamespaces.Approvals:
        return this.db.approvals;
      case StorageNamespaces.Transactions:
        return this.db.transactions;
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
    this.table = this.db.chainRegistry;
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
