import type { ArxStorageDatabase } from "../db.js";

export type StorageDexieLogger = {
  warn: (msg: string, detail?: unknown) => void;
};

export type DexieCtx = {
  db: ArxStorageDatabase;
  // Single shared open promise per DB instance (memoized).
  ready: ReturnType<ArxStorageDatabase["open"]>;
  log: StorageDexieLogger;
};

const readyByDb = new WeakMap<ArxStorageDatabase, ReturnType<ArxStorageDatabase["open"]>>();

export const createDexieCtx = (db: ArxStorageDatabase, log: StorageDexieLogger): DexieCtx => {
  const cached = readyByDb.get(db);
  if (cached) {
    return { db, ready: cached, log };
  }

  const ready = db.open();
  readyByDb.set(db, ready);
  return { db, ready, log };
};
