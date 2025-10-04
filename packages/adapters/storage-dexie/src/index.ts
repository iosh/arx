import {
  DOMAIN_SCHEMA_VERSION,
  type StorageNamespace,
  StorageNamespaces,
  type StoragePort,
  type StorageSnapshotMap,
  type StorageSnapshotSchemaMap,
  StorageSnapshotSchemas,
} from "@arx/core/storage";
import { Dexie, type PromiseExtended, type Table } from "dexie";

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

class ArxStorageDatabase extends Dexie {
  chains!: Table<SnapshotEntity, StorageNamespace>;
  accounts!: Table<SnapshotEntity, StorageNamespace>;
  permissions!: Table<SnapshotEntity, StorageNamespace>;
  approvals!: Table<SnapshotEntity, StorageNamespace>;
  transactions!: Table<SnapshotEntity, StorageNamespace>;
  vaultMeta!: Table<VaultMetaEntity, string>;

  constructor(name: string) {
    super(name);
    this.version(DOMAIN_SCHEMA_VERSION).stores({
      chains: "&namespace",
      accounts: "&namespace",
      permissions: "&namespace",
      approvals: "&namespace",
      transactions: "&namespace",
      vaultMeta: "&id",
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

export type CreateDexieStorageOptions = {
  databaseName?: string;
};

export const createDexieStorage = (options: CreateDexieStorageOptions = {}): StoragePort => {
  const dbName = options.databaseName ?? DEFAULT_DB_NAME;
  const db = new ArxStorageDatabase(dbName);
  return new DexieStoragePort(db);
};
