import type { PermissionRecordsReader } from "@arx/core/persistence";
import type { DexiePersistenceContext } from "../database.js";

export const createPermissionsReader = (context: DexiePersistenceContext): PermissionRecordsReader => ({
  listAll() {
    return context.read(async () => {
      await context.ready;
      return context.db.permissions.toArray();
    });
  },
});
