import type { ChainRegistryPort } from "@arx/core/chains";
import type { SettingsPort } from "@arx/core/services";
import type { SettingsRecord } from "@arx/core/storage";
import { type ChainRegistryEntity, ChainRegistryEntitySchema, SettingsRecordSchema } from "@arx/core/storage";
import type { Dexie, PromiseExtended, Table } from "dexie";
import { ArxStorageDatabase } from "./db.js";
import { DEFAULT_DB_NAME, getOrCreateDatabase } from "./sharedDb.js";

export * from "./ports/factories.js";
export * from "./storePorts.js";

type ChainRegistryRow = ChainRegistryEntity;

class DexieSettingsPort implements SettingsPort {
  private readonly ready: PromiseExtended<Dexie>;

  constructor(private readonly db: ArxStorageDatabase) {
    this.ready = this.db.open();
  }

  async get(): Promise<SettingsRecord | null> {
    await this.ready;
    const row = await this.db.settings.get("settings");
    if (!row) return null;

    const parsed = SettingsRecordSchema.safeParse(row);
    if (!parsed.success) {
      console.warn("[storage-dexie] invalid settings detected, dropping", parsed.error);
      await this.db.settings.delete("settings");
      return null;
    }
    return parsed.data;
  }

  async put(record: SettingsRecord): Promise<void> {
    await this.ready;
    const checked = SettingsRecordSchema.parse(record);
    await this.db.settings.put(checked);
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

export type CreateDexieSettingsPortOptions = { databaseName?: string };

export const createDexieSettingsPort = (options: CreateDexieSettingsPortOptions = {}): SettingsPort => {
  const dbName = options.databaseName ?? DEFAULT_DB_NAME;
  const db = getOrCreateDatabase(dbName, (name) => new ArxStorageDatabase(name));
  return new DexieSettingsPort(db);
};

export type CreateDexieChainRegistryPortOptions = {
  databaseName?: string;
};

export const createDexieChainRegistryPort = (options: CreateDexieChainRegistryPortOptions = {}): ChainRegistryPort => {
  const dbName = options.databaseName ?? DEFAULT_DB_NAME;
  const db = getOrCreateDatabase(dbName, (name) => new ArxStorageDatabase(name));
  return new DexieChainRegistryPort(db);
};
