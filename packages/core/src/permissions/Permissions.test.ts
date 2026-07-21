import { describe, expect, it } from "vitest";
import type { AccountId } from "../accounts/accountId.js";
import {
  AccountHiddenSelectionError,
  AccountNamespaceMismatchError,
  AccountNotFoundError,
} from "../accounts/errors.js";
import type { Account } from "../accounts/types.js";
import type { DappNetworkSelectionRecord } from "../dappConnections/persistence.js";
import { dappConnectionScopeKey } from "../dappConnections/scope.js";
import type { Namespace } from "../namespaces/types.js";
import { PermissionNetworkSelectionMissingError } from "./errors.js";
import { Permissions, permissionsChangedFromUpdate } from "./Permissions.js";
import type { PermissionRecord, PermissionScope } from "./persistence.js";

const EIP155_ACCOUNT_A = "eip155:0000000000000000000000000000000000000001";
const EIP155_ACCOUNT_B = "eip155:0000000000000000000000000000000000000002";
const EIP155_HIDDEN_ACCOUNT = "eip155:0000000000000000000000000000000000000003";
const SOLANA_ACCOUNT = "solana:account-1";
const MISSING_ACCOUNT = "eip155:0000000000000000000000000000000000000004";

const account = (accountId: AccountId, namespace: Namespace, hidden = false): Account => ({
  accountId,
  namespace,
  origin: { type: "hd", hdKeyringId: `keyring-${namespace}`, derivationIndex: 0 },
  hidden,
  selected: false,
  createdAt: 1,
});

const accounts = [
  account(EIP155_ACCOUNT_A, "eip155"),
  account(EIP155_ACCOUNT_B, "eip155"),
  account(EIP155_HIDDEN_ACCOUNT, "eip155", true),
  account(SOLANA_ACCOUNT, "solana"),
];

const permission = (
  origin: string,
  namespace: Namespace,
  accountIds: [AccountId, ...AccountId[]],
): PermissionRecord => ({ origin, namespace, accountIds });

const selectionFor = (scope: PermissionScope): DappNetworkSelectionRecord => ({
  ...scope,
  chainRef: scope.namespace === "solana" ? "solana:mainnet" : `${scope.namespace}:1`,
});

const createPermissions = (options: {
  records?: readonly PermissionRecord[];
  accounts?: readonly Account[];
  selectedScopes?: readonly PermissionScope[];
}): Permissions => {
  const records = options.records ?? [];
  const accountsById = new Map((options.accounts ?? accounts).map((entry) => [entry.accountId, entry]));
  const selectedScopes = new Set((options.selectedScopes ?? records).map(dappConnectionScopeKey));

  return new Permissions({
    bootstrap: { records },
    accounts: {
      getAccount: (accountId) => accountsById.get(accountId) ?? null,
    },
    dappConnections: {
      getNetworkSelection: (scope) => (selectedScopes.has(dappConnectionScopeKey(scope)) ? selectionFor(scope) : null),
    },
  });
};

describe("Permissions", () => {
  it("loads stable synchronous readers and rejects broken owner references", () => {
    const first = permission("https://a.example", "eip155", [EIP155_ACCOUNT_A]);
    const second = permission("https://a.example", "solana", [SOLANA_ACCOUNT]);
    const third = permission("https://b.example", "eip155", [EIP155_ACCOUNT_B]);
    const permissions = createPermissions({ records: [third, second, first] });

    expect(permissions.get(first)).toEqual(first);
    expect(permissions.list()).toEqual([first, second, third]);
    expect(permissions.listByOrigin(first.origin)).toEqual([first, second]);

    expect(() => createPermissions({ records: [permission(first.origin, "eip155", [MISSING_ACCOUNT])] })).toThrow(
      AccountNotFoundError,
    );
    expect(() => createPermissions({ records: [permission(first.origin, "eip155", [EIP155_HIDDEN_ACCOUNT])] })).toThrow(
      AccountHiddenSelectionError,
    );
    expect(() => createPermissions({ records: [permission(first.origin, "solana", [EIP155_ACCOUNT_A])] })).toThrow(
      AccountNamespaceMismatchError,
    );
    expect(() => createPermissions({ records: [first], selectedScopes: [] })).toThrow(
      PermissionNetworkSelectionMissingError,
    );
  });

  it("builds exact ordered replacements and ignores unchanged account lists", () => {
    const initial = permission("https://dapp.example", "eip155", [EIP155_ACCOUNT_A, EIP155_ACCOUNT_B]);
    const reordered = permission(initial.origin, initial.namespace, [EIP155_ACCOUNT_B, EIP155_ACCOUNT_A]);
    const permissions = createPermissions({ records: [initial] });

    expect(permissions.prepareSetAccounts(initial)).toBeNull();

    const update = permissions.prepareSetAccounts(reordered);
    if (!update) throw new Error("Expected a permission replacement draft");
    expect(permissions.get(initial)).toEqual(initial);
    expect(update.persistenceChanges).toEqual([{ persistenceType: "permission", operation: "put", value: reordered }]);
    expect(permissionsChangedFromUpdate(update)).toEqual({
      type: "permissionsChanged",
      scopes: [{ origin: initial.origin, namespace: initial.namespace }],
    });

    permissions.applyCommittedUpdate(update);
    expect(permissions.get(initial)).toEqual(reordered);
  });

  it("builds scope and origin revocation drafts", () => {
    const first = permission("https://a.example", "eip155", [EIP155_ACCOUNT_A]);
    const second = permission("https://a.example", "solana", [SOLANA_ACCOUNT]);
    const third = permission("https://b.example", "eip155", [EIP155_ACCOUNT_B]);
    const permissions = createPermissions({ records: [third, second, first] });

    expect(permissions.prepareRevoke({ origin: "https://missing.example", namespace: "eip155" })).toBeNull();

    const scopeUpdate = permissions.prepareRevoke(second);
    if (!scopeUpdate) throw new Error("Expected a permission revocation draft");
    permissions.applyCommittedUpdate(scopeUpdate);
    expect(permissions.list()).toEqual([first, third]);

    const originUpdate = permissions.prepareRevokeOrigin(first.origin);
    if (!originUpdate) throw new Error("Expected an origin revocation draft");
    expect(originUpdate.changedScopes).toEqual([{ origin: first.origin, namespace: first.namespace }]);
    permissions.applyCommittedUpdate(originUpdate);
    expect(permissions.list()).toEqual([third]);
    expect(permissions.prepareRevokeOrigin(first.origin)).toBeNull();
  });

  it("removes account references and deletes permissions that become empty", () => {
    const retained = permission("https://a.example", "eip155", [EIP155_ACCOUNT_A, EIP155_ACCOUNT_B]);
    const removed = permission("https://b.example", "eip155", [EIP155_ACCOUNT_A]);
    const unrelated = permission("https://c.example", "solana", [SOLANA_ACCOUNT]);
    const permissions = createPermissions({ records: [unrelated, removed, retained] });

    expect(permissions.prepareRemoveAccountReferences([])).toBeNull();
    expect(permissions.prepareRemoveAccountReferences([MISSING_ACCOUNT])).toBeNull();

    const update = permissions.prepareRemoveAccountReferences([EIP155_ACCOUNT_A]);
    if (!update) throw new Error("Expected an account-reference removal draft");
    expect(update.changedScopes).toEqual([
      { origin: retained.origin, namespace: retained.namespace },
      { origin: removed.origin, namespace: removed.namespace },
    ]);
    permissions.applyCommittedUpdate(update);
    expect(permissions.list()).toEqual([{ ...retained, accountIds: [EIP155_ACCOUNT_B] }, unrelated]);

    const reset = permissions.prepareReset();
    if (!reset) throw new Error("Expected a permissions reset draft");
    permissions.applyCommittedUpdate(reset);
    expect(permissions.list()).toEqual([]);
    expect(permissions.prepareReset()).toBeNull();
  });
});
