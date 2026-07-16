import type { PermissionsReader } from "@arx/core/persistence";
import type { DexiePersistenceContext } from "../database.js";
import { permissionFromRow } from "../mappers/permissions.js";

export const createPermissionsReader = (context: DexiePersistenceContext): PermissionsReader => ({
  get(key) {
    return context.read(async () => {
      await context.ready;
      const row = await context.db.permissions.get([key.origin, key.namespace]);
      return row ? permissionFromRow(row) : null;
    });
  },

  listByOrigin(origin) {
    return context.read(async () => {
      await context.ready;
      const rows = await context.db.permissions.where("origin").equals(origin).toArray();
      return rows.map(permissionFromRow);
    });
  },

  listReferencingAccountIds(accountIds) {
    return context.read(async () => {
      await context.ready;
      if (accountIds.length === 0) return [];
      const rows = await context.db.permissions
        .where("indexedAccountIds")
        .anyOf([...accountIds])
        .distinct()
        .toArray();
      return rows.map(permissionFromRow);
    });
  },

  listReferencingChainRef(chainRef) {
    return context.read(async () => {
      await context.ready;
      const rows = await context.db.permissions.where("indexedChainRefs").equals(chainRef).toArray();
      return rows.map(permissionFromRow);
    });
  },

  listAll() {
    return context.read(async () => {
      await context.ready;
      const rows = await context.db.permissions.toArray();
      return rows.map(permissionFromRow);
    });
  },
});
