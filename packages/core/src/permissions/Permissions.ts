import type { Accounts } from "../accounts/Accounts.js";
import type { AccountId } from "../accounts/accountId.js";
import {
  AccountHiddenSelectionError,
  AccountNamespaceMismatchError,
  AccountNotFoundError,
} from "../accounts/errors.js";
import type { DappConnections } from "../dappConnections/DappConnections.js";
import { dappConnectionScopeKey } from "../dappConnections/scope.js";
import { persistenceChange } from "../persistence/change.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import type { PermissionsBootstrap } from "./bootstrap.js";
import { PermissionNetworkSelectionMissingError } from "./errors.js";
import { type PermissionRecord, type PermissionScope, permissionPersistenceType } from "./persistence.js";

export type Permission = PermissionRecord;

export type PermissionsReader = Readonly<{
  get(scope: PermissionScope): Permission | null;
  list(): readonly Permission[];
  listByOrigin(origin: string): readonly Permission[];
}>;

export type PermissionsChanged = Readonly<{
  type: "permissionsChanged";
  scopes: readonly PermissionScope[];
}>;

export type PermissionsUpdate = Readonly<{
  nextRecords: ReadonlyMap<string, PermissionRecord>;
  persistenceChanges: readonly PersistenceChange[];
  changedScopes: readonly PermissionScope[];
}>;

type PermissionsOptions = Readonly<{
  bootstrap: PermissionsBootstrap;
  accounts: Pick<Accounts, "getAccount">;
  dappConnections: Pick<DappConnections, "getNetworkSelection">;
}>;

const comparePermissions = (left: Permission, right: Permission): number =>
  left.origin.localeCompare(right.origin) || left.namespace.localeCompare(right.namespace);

const permissionScope = (permission: Permission): PermissionScope => ({
  origin: permission.origin,
  namespace: permission.namespace,
});

const accountIdsEqual = (left: readonly AccountId[], right: readonly AccountId[]): boolean =>
  left.length === right.length && left.every((accountId, index) => accountId === right[index]);

/** Owns persistent origin and namespace account authorization state. */
export class Permissions implements PermissionsReader {
  readonly #accounts: Pick<Accounts, "getAccount">;
  #records: ReadonlyMap<string, PermissionRecord>;

  constructor(options: PermissionsOptions) {
    this.#accounts = options.accounts;

    const records = new Map<string, PermissionRecord>();
    for (const record of options.bootstrap.records) {
      this.#requireVisibleAccounts(record);
      if (!options.dappConnections.getNetworkSelection(record)) {
        throw new PermissionNetworkSelectionMissingError(permissionScope(record));
      }

      records.set(dappConnectionScopeKey(record), record);
    }

    this.#records = records;
  }

  get(scope: PermissionScope): Permission | null {
    return this.#records.get(dappConnectionScopeKey(scope)) ?? null;
  }

  list(): readonly Permission[] {
    return [...this.#records.values()].sort(comparePermissions);
  }

  listByOrigin(origin: string): readonly Permission[] {
    return this.list().filter((permission) => permission.origin === origin);
  }

  prepareSetAccounts(permission: Permission): PermissionsUpdate | null {
    const current = this.get(permission);
    if (current && accountIdsEqual(current.accountIds, permission.accountIds)) return null;

    this.#requireVisibleAccounts(permission);

    const nextRecords = new Map(this.#records);
    nextRecords.set(dappConnectionScopeKey(permission), permission);

    return {
      nextRecords,
      persistenceChanges: [persistenceChange.put(permissionPersistenceType, permission)],
      changedScopes: [permissionScope(permission)],
    };
  }

  prepareRevoke(scope: PermissionScope): PermissionsUpdate | null {
    const current = this.get(scope);
    if (!current) return null;

    const nextRecords = new Map(this.#records);
    nextRecords.delete(dappConnectionScopeKey(scope));

    return {
      nextRecords,
      persistenceChanges: [persistenceChange.remove(permissionPersistenceType, scope)],
      changedScopes: [permissionScope(current)],
    };
  }

  prepareRevokeOrigin(origin: string): PermissionsUpdate | null {
    const removed = this.listByOrigin(origin);
    if (removed.length === 0) return null;

    const nextRecords = new Map(this.#records);
    for (const permission of removed) {
      nextRecords.delete(dappConnectionScopeKey(permission));
    }

    return {
      nextRecords,
      persistenceChanges: removed.map((permission) =>
        persistenceChange.remove(permissionPersistenceType, permissionScope(permission)),
      ),
      changedScopes: removed.map(permissionScope),
    };
  }

  prepareRemoveAccountReferences(accountIds: readonly AccountId[]): PermissionsUpdate | null {
    if (accountIds.length === 0) return null;

    const removedAccountIds = new Set(accountIds);
    const nextRecords = new Map(this.#records);
    const persistenceChanges: PersistenceChange[] = [];
    const changedScopes: PermissionScope[] = [];

    for (const permission of this.list()) {
      const remainingAccountIds = permission.accountIds.filter((accountId) => !removedAccountIds.has(accountId));
      if (remainingAccountIds.length === permission.accountIds.length) continue;

      const scope = permissionScope(permission);
      changedScopes.push(scope);

      if (remainingAccountIds.length === 0) {
        nextRecords.delete(dappConnectionScopeKey(permission));
        persistenceChanges.push(persistenceChange.remove(permissionPersistenceType, scope));
        continue;
      }

      const updated: PermissionRecord = {
        ...permission,
        accountIds: remainingAccountIds as [AccountId, ...AccountId[]],
      };
      nextRecords.set(dappConnectionScopeKey(updated), updated);
      persistenceChanges.push(persistenceChange.put(permissionPersistenceType, updated));
    }

    if (changedScopes.length === 0) return null;
    return { nextRecords, persistenceChanges, changedScopes };
  }

  prepareReset(): PermissionsUpdate | null {
    const removed = this.list();
    if (removed.length === 0) return null;

    return {
      nextRecords: new Map(),
      persistenceChanges: removed.map((permission) =>
        persistenceChange.remove(permissionPersistenceType, permissionScope(permission)),
      ),
      changedScopes: removed.map(permissionScope),
    };
  }

  applyCommittedUpdate(update: PermissionsUpdate): void {
    this.#records = update.nextRecords;
  }

  #requireVisibleAccounts(permission: Permission): void {
    for (const accountId of permission.accountIds) {
      const account = this.#accounts.getAccount(accountId);
      if (!account) throw new AccountNotFoundError(accountId);

      if (account.namespace !== permission.namespace) {
        throw new AccountNamespaceMismatchError({
          accountId,
          accountNamespace: account.namespace,
          expectedNamespace: permission.namespace,
        });
      }

      if (account.hidden) throw new AccountHiddenSelectionError(accountId);
    }
  }
}

export const permissionsChangedFromUpdate = (update: PermissionsUpdate): PermissionsChanged => ({
  type: "permissionsChanged",
  scopes: update.changedScopes,
});
