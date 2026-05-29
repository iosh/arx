import type { ArxStorageDatabase } from "../db.js";

export type StorageDexieLogger = {
  warn: (msg: string, detail?: unknown) => void;
};

export type DexieCtx = {
  db: ArxStorageDatabase;
  ready: ReturnType<ArxStorageDatabase["open"]>;
  log: StorageDexieLogger;
};

export const createDexieCtx = (db: ArxStorageDatabase, log: StorageDexieLogger): DexieCtx => ({
  db,
  ready: db.open(),
  log,
});
