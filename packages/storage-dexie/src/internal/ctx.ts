import type { ArxStorageDatabase } from "../db.js";

export type DexieCtx = {
  db: ArxStorageDatabase;
  ready: ReturnType<ArxStorageDatabase["open"]>;
};

export const createDexieCtx = (db: ArxStorageDatabase): DexieCtx => ({
  db,
  ready: db.open(),
});
