import { describe, expect, it } from "vitest";
import type { AccountId } from "../accounts/accountId.js";
import type { AccountMember } from "../accounts/types.js";
import type { Namespace } from "../namespaces/types.js";
import { Permissions, type PermissionsChanged } from "./Permissions.js";
import type { PermissionRecord } from "./persistence.js";

const EIP155_ACCOUNT_A = "eip155:0000000000000000000000000000000000000001";
const EIP155_ACCOUNT_B = "eip155:0000000000000000000000000000000000000002";
const MISSING_ACCOUNT = "eip155:0000000000000000000000000000000000000004";

const account = (accountId: AccountId, namespace: Namespace): AccountMember => ({
  accountId,
  accountGroupId: `group-${accountId}`,
  namespace,
  origin: { type: "hd", hdKeyringId: `keyring-${namespace}`, derivationIndex: 0 },
  hidden: false,
});

const accounts = [account(EIP155_ACCOUNT_A, "eip155"), account(EIP155_ACCOUNT_B, "eip155")];

const permission = (
  origin: string,
  namespace: Namespace,
  accountIds: [AccountId, ...AccountId[]],
): PermissionRecord => ({ origin, namespace, accountIds });

const createPermissions = (options: { records?: readonly PermissionRecord[] }) => {
  const records = options.records ?? [];
  const accountsById = new Map(accounts.map((entry) => [entry.accountId, entry]));

  const changes: PermissionsChanged[] = [];
  const permissions = new Permissions({
    bootstrap: { records },
    accounts: {
      getMember: (accountId) => accountsById.get(accountId) ?? null,
    },
    publishChanged: (change) => changes.push(change),
  });
  return { permissions, changes };
};

describe("Permissions", () => {
  it("builds exact ordered replacements and ignores unchanged account lists", () => {
    const initial = permission("https://dapp.example", "eip155", [EIP155_ACCOUNT_A, EIP155_ACCOUNT_B]);
    const reordered = permission(initial.origin, initial.namespace, [EIP155_ACCOUNT_B, EIP155_ACCOUNT_A]);
    const { permissions, changes } = createPermissions({ records: [initial] });

    expect(permissions.prepareSetAccounts(initial)).toBeNull();

    const update = permissions.prepareSetAccounts(reordered);
    if (!update) throw new Error("Expected a permission replacement draft");
    expect(permissions.get(initial)).toEqual(initial);
    expect(update.persistenceChanges).toEqual([{ persistenceType: "permission", operation: "put", value: reordered }]);

    update.activate();
    update.publish();
    expect(permissions.get(initial)).toEqual(reordered);
    expect(changes).toEqual([
      { type: "permissionsChanged", scopes: [{ origin: initial.origin, namespace: initial.namespace }] },
    ]);
  });

  it("builds scope and origin revocation drafts", () => {
    const first = permission("https://a.example", "eip155", [EIP155_ACCOUNT_A]);
    const second = permission("https://c.example", "eip155", [EIP155_ACCOUNT_B]);
    const third = permission("https://b.example", "eip155", [EIP155_ACCOUNT_B]);
    const { permissions, changes } = createPermissions({ records: [third, second, first] });

    expect(permissions.prepareRevoke({ origin: "https://missing.example", namespace: "eip155" })).toBeNull();

    const scopeUpdate = permissions.prepareRevoke(second);
    if (!scopeUpdate) throw new Error("Expected a permission revocation draft");
    scopeUpdate.activate();
    scopeUpdate.publish();
    expect(permissions.list()).toEqual([first, third]);

    const originUpdate = permissions.prepareRevokeOrigin(first.origin);
    if (!originUpdate) throw new Error("Expected an origin revocation draft");
    originUpdate.activate();
    originUpdate.publish();
    expect(changes[1]).toEqual({
      type: "permissionsChanged",
      scopes: [{ origin: first.origin, namespace: first.namespace }],
    });
    expect(permissions.list()).toEqual([third]);
    expect(permissions.prepareRevokeOrigin(first.origin)).toBeNull();
  });

  it("removes account references and deletes permissions that become empty", () => {
    const retained = permission("https://a.example", "eip155", [EIP155_ACCOUNT_A, EIP155_ACCOUNT_B]);
    const removed = permission("https://b.example", "eip155", [EIP155_ACCOUNT_A]);
    const unrelated = permission("https://c.example", "eip155", [EIP155_ACCOUNT_B]);
    const { permissions, changes } = createPermissions({ records: [unrelated, removed, retained] });

    expect(permissions.prepareRemoveAccountReferences([])).toBeNull();
    expect(permissions.prepareRemoveAccountReferences([MISSING_ACCOUNT])).toBeNull();

    const update = permissions.prepareRemoveAccountReferences([EIP155_ACCOUNT_A]);
    if (!update) throw new Error("Expected an account-reference removal draft");
    update.activate();
    update.publish();
    expect(changes).toEqual([
      {
        type: "permissionsChanged",
        scopes: [
          { origin: retained.origin, namespace: retained.namespace },
          { origin: removed.origin, namespace: removed.namespace },
        ],
      },
    ]);
    expect(permissions.list()).toEqual([{ ...retained, accountIds: [EIP155_ACCOUNT_B] }, unrelated]);
  });
});
