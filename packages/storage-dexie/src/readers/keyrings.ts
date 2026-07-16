import type { HdKeyringsReader, KeySourcesReader } from "@arx/core/persistence";
import type { DexiePersistenceContext } from "../database.js";

export const createKeySourcesReader = (context: DexiePersistenceContext): KeySourcesReader => ({
  get(keySourceId) {
    return context.read(async () => {
      await context.ready;
      return (await context.db.keySources.get(keySourceId)) ?? null;
    });
  },

  listAll() {
    return context.read(async () => {
      await context.ready;
      return await context.db.keySources.toArray();
    });
  },
});

export const createHdKeyringsReader = (context: DexiePersistenceContext): HdKeyringsReader => ({
  get(keyringId) {
    return context.read(async () => {
      await context.ready;
      return (await context.db.hdKeyrings.get(keyringId)) ?? null;
    });
  },

  listByKeySourceIds(keySourceIds) {
    return context.read(async () => {
      await context.ready;
      if (keySourceIds.length === 0) return [];
      return await context.db.hdKeyrings
        .where("keySourceId")
        .anyOf([...keySourceIds])
        .toArray();
    });
  },

  listByNamespace(namespace) {
    return context.read(async () => {
      await context.ready;
      return await context.db.hdKeyrings.where("namespace").equals(namespace).toArray();
    });
  },

  listAll() {
    return context.read(async () => {
      await context.ready;
      return await context.db.hdKeyrings.toArray();
    });
  },
});
