import type { HdKeyringsReader, KeySourcesReader } from "@arx/core/persistence";
import type { DexiePersistenceContext } from "../database.js";

export const createKeySourcesReader = (context: DexiePersistenceContext): KeySourcesReader => ({
  async get(keySourceId) {
    await context.ready;
    return (await context.db.keySources.get(keySourceId)) ?? null;
  },

  async listAll() {
    await context.ready;
    return await context.db.keySources.toArray();
  },
});

export const createHdKeyringsReader = (context: DexiePersistenceContext): HdKeyringsReader => ({
  async get(keyringId) {
    await context.ready;
    return (await context.db.hdKeyrings.get(keyringId)) ?? null;
  },

  async listByKeySourceIds(keySourceIds) {
    await context.ready;
    if (keySourceIds.length === 0) return [];
    return await context.db.hdKeyrings
      .where("keySourceId")
      .anyOf([...keySourceIds])
      .toArray();
  },

  async listByNamespace(namespace) {
    await context.ready;
    return await context.db.hdKeyrings.where("namespace").equals(namespace).toArray();
  },

  async listAll() {
    await context.ready;
    return await context.db.hdKeyrings.toArray();
  },
});
