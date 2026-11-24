import type { AccountId } from "../accounts/accountId.js";
import type { Namespace } from "../namespaces/types.js";
import { defineKeyedPersistenceType, type KeyedPersistenceType } from "../persistence/definition.js";
import type { DappScope } from "./scope.js";

export type PermissionRecord = Readonly<{
  origin: string;
  namespace: Namespace;
  accountIds: readonly [AccountId, ...AccountId[]];
}>;

export interface PermissionRecordsReader {
  listAll(): Promise<readonly PermissionRecord[]>;
}

export const permissionWrites: KeyedPersistenceType<"permission", PermissionRecord, DappScope> =
  defineKeyedPersistenceType<"permission", PermissionRecord, DappScope>("permission");
