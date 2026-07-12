import type { AccountId } from "../accounts/accountId.js";
import type { ChainRef } from "../chains/ids.js";
import { persistenceChange } from "../persistence/change.js";
import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { OriginNamespaceKey } from "../persistence/keys.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import { type PermissionRecord, permissionPersistenceType } from "./persistence.js";

export type PermissionsChanged = Readonly<{
  keys: readonly OriginNamespaceKey[];
}>;

export type Permissions = Readonly<{
  get(key: OriginNamespaceKey): Promise<PermissionRecord | null>;
  listByOrigin(origin: string): Promise<readonly PermissionRecord[]>;
  grant(
    input: OriginNamespaceKey & { chainRefs: readonly ChainRef[]; accountIds: readonly AccountId[] },
  ): Promise<void>;
  removeOrigin(origin: string): Promise<void>;
  isAuthorized(input: OriginNamespaceKey & { chainRef: ChainRef }): Promise<boolean>;
  listAccountIds(input: OriginNamespaceKey & { chainRef: ChainRef }): Promise<readonly AccountId[]>;
}>;

export const createPermissions = (params: {
  readers: Pick<CorePersistenceReaders, "permissions">;
  mutations: CoreMutationQueue;
  /** Publishes committed permission changes and must not throw. */
  publishChanged(change: PermissionsChanged): void;
}): Permissions => {
  const keyOf = (record: Pick<PermissionRecord, "origin" | "namespace">): OriginNamespaceKey => ({
    origin: record.origin,
    namespace: record.namespace,
  });

  return {
    get: (key) => params.readers.permissions.get(key),
    listByOrigin: (origin) => params.readers.permissions.listByOrigin(origin),
    grant: async ({ origin, namespace, chainRefs, accountIds }) => {
      await params.mutations.run(async (commit) => {
        const key = { origin, namespace };
        const current = await params.readers.permissions.get(key);
        const chainScopes = { ...(current?.chainScopes ?? {}) };
        for (const chainRef of chainRefs) chainScopes[chainRef] = [...accountIds];
        const next: PermissionRecord = { origin, namespace, chainScopes };
        await commit([persistenceChange.put(permissionPersistenceType, next)]);
        params.publishChanged({ keys: [key] });
      });
    },
    removeOrigin: async (origin) => {
      await params.mutations.run(async (commit) => {
        const records = await params.readers.permissions.listByOrigin(origin);
        if (records.length === 0) return;
        await commit(records.map((record) => persistenceChange.remove(permissionPersistenceType, keyOf(record))));
        params.publishChanged({ keys: records.map(keyOf) });
      });
    },
    isAuthorized: async ({ origin, namespace, chainRef }) => {
      const record = await params.readers.permissions.get({ origin, namespace });
      return (record?.chainScopes[chainRef]?.length ?? 0) > 0;
    },
    listAccountIds: async ({ origin, namespace, chainRef }) => {
      const record = await params.readers.permissions.get({ origin, namespace });
      return record?.chainScopes[chainRef] ?? [];
    },
  };
};
