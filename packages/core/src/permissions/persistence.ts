import type { AccountId } from "../accounts/accountId.js";
import type { ChainRef } from "../chains/ids.js";
import { defineKeyedPersistenceType, type KeyedPersistenceType } from "../persistence/definition.js";
import type { OriginNamespaceKey } from "../persistence/keys.js";

export type PermissionChainScopes = Readonly<Record<ChainRef, readonly AccountId[]>>;

export type PermissionRecord = Readonly<{
  origin: string;
  namespace: string;
  chainScopes: PermissionChainScopes;
}>;

export interface PermissionsReader {
  get(key: OriginNamespaceKey): Promise<PermissionRecord | null>;
  listByOrigin(origin: string): Promise<PermissionRecord[]>;
  listReferencingAccountIds(accountIds: readonly AccountId[]): Promise<PermissionRecord[]>;
  listReferencingChainRef(chainRef: ChainRef): Promise<PermissionRecord[]>;
  listAll(): Promise<PermissionRecord[]>;
}

export const permissionPersistenceType: KeyedPersistenceType<"permission", PermissionRecord, OriginNamespaceKey> =
  defineKeyedPersistenceType<"permission", PermissionRecord, OriginNamespaceKey>("permission");
