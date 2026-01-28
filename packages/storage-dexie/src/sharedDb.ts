import type { Dexie } from "dexie";

export const DEFAULT_DB_NAME = "arx-storage";

const databaseRegistry = new Map<string, Dexie>();

export const getOrCreateDatabase = <TDb extends Dexie>(dbName: string, factory: (name: string) => TDb): TDb => {
  const cached = databaseRegistry.get(dbName) as TDb | undefined;
  if (cached) {
    return cached;
  }

  const db = factory(dbName);
  databaseRegistry.set(dbName, db);

  db.on("close", () => {
    if (databaseRegistry.get(dbName) === db) {
      databaseRegistry.delete(dbName);
    }
  });

  return db;
};
