import type { PermissionsReader } from "@arx/core/persistence";
import type { DexiePersistenceContext } from "../database.js";
import { permissionFromRow } from "../mappers/permissions.js";

export const createPermissionsReader = (context: DexiePersistenceContext): PermissionsReader => ({
  async get(key) {
    await context.ready;
    const row = await context.db.permissions.get([key.origin, key.namespace]);
    return row ? permissionFromRow(row) : null;
  },

  async listByOrigin(origin) {
    await context.ready;
    const rows = await context.db.permissions.where("origin").equals(origin).toArray();
    return rows.map(permissionFromRow);
  },

  async listReferencingAccountIds(accountIds) {
    await context.ready;
    if (accountIds.length === 0) return [];
    const rows = await context.db.permissions
      .where("indexedAccountIds")
      .anyOf([...accountIds])
      .distinct()
      .toArray();
    return rows.map(permissionFromRow);
  },

  async listReferencingChainRef(chainRef) {
    await context.ready;
    const rows = await context.db.permissions.where("indexedChainRefs").equals(chainRef).toArray();
    return rows.map(permissionFromRow);
  },

  async listAll() {
    await context.ready;
    const rows = await context.db.permissions.toArray();
    return rows.map(permissionFromRow);
  },
});
