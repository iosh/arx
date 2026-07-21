import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { PermissionRecord } from "./persistence.js";

export type PermissionsBootstrap = Readonly<{
  records: readonly PermissionRecord[];
}>;

export const loadPermissionsBootstrap = async (
  readers: Pick<CorePersistenceReaders, "permissions">,
): Promise<PermissionsBootstrap> => ({
  records: await readers.permissions.listAll(),
});
