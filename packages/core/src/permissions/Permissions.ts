import type { Accounts } from "../accounts/Accounts.js";
import type { AccountId } from "../accounts/accountId.js";
import {
  AccountHiddenSelectionError,
  AccountNamespaceMismatchError,
  AccountNotFoundError,
} from "../accounts/errors.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import type { PreparedUpdate } from "../persistence/preparedUpdate.js";
import type { PermissionsBootstrap } from "./bootstrap.js";
import { type PermissionRecord, permissionWrites } from "./persistence.js";
import { type DappScope, dappScopeKey } from "./scope.js";

export type Permission = PermissionRecord;

export type PermissionsReader = Readonly<{
  get(scope: DappScope): Permission | null;
  list(): readonly Permission[];
  listByOrigin(origin: string): readonly Permission[];
}>;

export type PermissionsChanged = Readonly<{
  type: "permissionsChanged";
  scopes: readonly DappScope[];
}>;

type PermissionsOptions = Readonly<{
  bootstrap: PermissionsBootstrap;
  accounts: Pick<Accounts, "getMember">;
  publishChanged(change: PermissionsChanged): void;
}>;

const comparePermissions = (left: Permission, right: Permission): number =>
  left.origin.localeCompare(right.origin) || left.namespace.localeCompare(right.namespace);

const permissionScope = (permission: Permission): DappScope => ({
  origin: permission.origin,
  namespace: permission.namespace,
});

const accountIdsEqual = (left: readonly AccountId[], right: readonly AccountId[]): boolean =>
  left.length === right.length && left.every((accountId, index) => accountId === right[index]);

/**
 * Owns account authorization. Complete commands refresh connections after changes;
 * revocation and disconnection also cancel affected approvals after committing.
 */
export class Permissions implements PermissionsReader {
  readonly #accounts: Pick<Accounts, "getMember">;
  readonly #publishChanged: PermissionsOptions["publishChanged"];
  #records: ReadonlyMap<string, PermissionRecord>;

  constructor(options: PermissionsOptions) {
    this.#accounts = options.accounts;
    this.#publishChanged = options.publishChanged;

    this.#records = new Map(options.bootstrap.records.map((record) => [dappScopeKey(record), record]));
  }

  get(scope: DappScope): Permission | null {
    return this.#records.get(dappScopeKey(scope)) ?? null;
  }

  list(): readonly Permission[] {
    return [...this.#records.values()].sort(comparePermissions);
  }

  listByOrigin(origin: string): readonly Permission[] {
    return this.list().filter((permission) => permission.origin === origin);
  }

  prepareSetAccounts(permission: Permission): PreparedUpdate | null {
    const current = this.get(permission);
    if (current && accountIdsEqual(current.accountIds, permission.accountIds)) return null;

    this.#requireVisibleAccounts(permission);

    const nextRecords = new Map(this.#records);
    nextRecords.set(dappScopeKey(permission), permission);

    return this.#prepareUpdate(nextRecords, [permissionWrites.put(permission)], [permissionScope(permission)]);
  }

  prepareRevoke(scope: DappScope): PreparedUpdate | null {
    const current = this.get(scope);
    if (!current) return null;

    const nextRecords = new Map(this.#records);
    nextRecords.delete(dappScopeKey(scope));

    return this.#prepareUpdate(nextRecords, [permissionWrites.remove(scope)], [permissionScope(current)]);
  }

  prepareRevokeOrigin(origin: string): PreparedUpdate | null {
    const removed = this.listByOrigin(origin);
    if (removed.length === 0) return null;

    const nextRecords = new Map(this.#records);
    for (const permission of removed) {
      nextRecords.delete(dappScopeKey(permission));
    }

    return this.#prepareUpdate(
      nextRecords,
      removed.map((permission) => permissionWrites.remove(permissionScope(permission))),
      removed.map(permissionScope),
    );
  }

  prepareRemoveAccountReferences(accountIds: readonly AccountId[]): PreparedUpdate | null {
    if (accountIds.length === 0) return null;

    const removedAccountIds = new Set(accountIds);
    const nextRecords = new Map(this.#records);
    const persistenceChanges: PersistenceChange[] = [];
    const changedScopes: DappScope[] = [];

    for (const permission of this.list()) {
      const remainingAccountIds = permission.accountIds.filter((accountId) => !removedAccountIds.has(accountId));
      if (remainingAccountIds.length === permission.accountIds.length) continue;

      const scope = permissionScope(permission);
      changedScopes.push(scope);

      if (remainingAccountIds.length === 0) {
        nextRecords.delete(dappScopeKey(permission));
        persistenceChanges.push(permissionWrites.remove(scope));
        continue;
      }

      const updated: PermissionRecord = {
        ...permission,
        accountIds: remainingAccountIds as [AccountId, ...AccountId[]],
      };
      nextRecords.set(dappScopeKey(updated), updated);
      persistenceChanges.push(permissionWrites.put(updated));
    }

    if (changedScopes.length === 0) return null;
    return this.#prepareUpdate(nextRecords, persistenceChanges, changedScopes);
  }

  #prepareUpdate(
    nextRecords: ReadonlyMap<string, PermissionRecord>,
    persistenceChanges: readonly PersistenceChange[],
    changedScopes: readonly DappScope[],
  ): PreparedUpdate {
    const change: PermissionsChanged = { type: "permissionsChanged", scopes: changedScopes };
    return {
      persistenceChanges,
      activate: () => {
        this.#records = nextRecords;
      },
      publish: () => this.#publishChanged(change),
    };
  }

  #requireVisibleAccounts(permission: Permission): void {
    for (const accountId of permission.accountIds) {
      const account = this.#accounts.getMember(accountId);
      if (!account) throw new AccountNotFoundError(accountId);

      if (account.namespace !== permission.namespace) {
        throw new AccountNamespaceMismatchError({
          accountId,
          accountNamespace: account.namespace,
          expectedNamespace: permission.namespace,
        });
      }

      if (account.hidden) throw new AccountHiddenSelectionError({ accountId });
    }
  }
}
