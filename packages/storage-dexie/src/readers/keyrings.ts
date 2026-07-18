import type { HdKeyringsReader, KeySourcesReader } from "@arx/core/persistence";
import type { DexiePersistenceContext } from "../database.js";

export const createKeySourcesReader = (context: DexiePersistenceContext): KeySourcesReader => ({
  listAll() {
    return context.read(async () => {
      await context.ready;
      return await context.db.keySources.toArray();
    });
  },
});

export const createHdKeyringsReader = (context: DexiePersistenceContext): HdKeyringsReader => ({
  listAll() {
    return context.read(async () => {
      await context.ready;
      return await context.db.hdKeyrings.toArray();
    });
  },
});
