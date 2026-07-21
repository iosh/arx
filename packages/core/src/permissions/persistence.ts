import type { AccountId } from "../accounts/accountId.js";
import type { Namespace } from "../namespaces/types.js";
import { defineKeyedPersistenceType, type KeyedPersistenceType } from "../persistence/definition.js";

export type PermissionScope = Readonly<{
  origin: string;
  namespace: Namespace;
}>;

export type PermissionRecord = Readonly<{
  origin: string;
  namespace: Namespace;
  accountIds: readonly [AccountId, ...AccountId[]];
}>;

export interface PermissionRecordsReader {
  listAll(): Promise<readonly PermissionRecord[]>;
}

export const permissionPersistenceType: KeyedPersistenceType<"permission", PermissionRecord, PermissionScope> =
  defineKeyedPersistenceType<"permission", PermissionRecord, PermissionScope>("permission");
