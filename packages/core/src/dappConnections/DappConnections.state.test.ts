import { describe, expect, it } from "vitest";
import { ADDRESS } from "../namespaces/eip155/__tests__/fixtures.js";
import type { PermissionRecord } from "../permissions/persistence.js";
import {
  createDappConnections,
  EIP155_ACCOUNT_A,
  EIP155_ACCOUNT_B,
  selection,
} from "./__tests__/DappConnections.testSupport.js";

describe("DappConnections active state", () => {
  it("opens a scope on its namespace's initial chain without persisting a site selection", () => {
    const scope = { origin: "https://dapp.example", namespace: "eip155" } as const;
    const { commits, dappConnections } = createDappConnections();

    expect(dappConnections.getConnectionState(scope, "eip155:1")).toEqual({ chainRef: "eip155:1", accounts: [] });
    expect(dappConnections.isConnectionOpen(scope)).toBe(false);

    expect(dappConnections.openConnection(scope, "eip155:1")).toEqual({ chainRef: "eip155:1", accounts: [] });
    expect(dappConnections.isConnectionOpen(scope)).toBe(true);
    expect(commits).toEqual([]);

    expect(dappConnections.getNetworkSelection(scope)).toBeNull();
  });

  it("refreshes every active connection", () => {
    const firstScope = { origin: "https://a.example", namespace: "eip155" } as const;
    const secondScope = { origin: "https://b.example", namespace: "eip155" } as const;
    const firstPermission: PermissionRecord = { ...firstScope, accountIds: [EIP155_ACCOUNT_A] };
    const secondPermission: PermissionRecord = { ...secondScope, accountIds: [EIP155_ACCOUNT_B] };
    const { dappConnections, setWalletStatus, stateChanges } = createDappConnections({
      walletStatus: "locked",
      permissions: [firstPermission, secondPermission],
    });

    dappConnections.openConnection(secondScope, "eip155:1");
    dappConnections.openConnection(firstScope, "eip155:1");
    expect(stateChanges).toEqual([]);

    setWalletStatus("unlocked");
    dappConnections.refreshAccountsForOpenConnections();

    const firstState = {
      chainRef: "eip155:1",
      accounts: [ADDRESS],
    } as const;
    const secondState = {
      chainRef: "eip155:1",
      accounts: ["0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"],
    } as const;

    expect(dappConnections.getConnectionState(firstScope, "eip155:1")).toEqual(firstState);
    expect(dappConnections.getConnectionState(secondScope, "eip155:1")).toEqual(secondState);
    expect(stateChanges).toEqual([
      {
        scope: firstScope,
        state: firstState,
        changedFields: { chainRef: false, accounts: true },
      },
      {
        scope: secondScope,
        state: secondState,
        changedFields: { chainRef: false, accounts: true },
      },
    ]);

    dappConnections.refreshAccountsForOpenConnections();
    expect(stateChanges).toHaveLength(2);
  });

  it("hides locked accounts immediately without consuming the later refresh event", () => {
    const scope = { origin: "https://dapp.example", namespace: "eip155" } as const;
    const { dappConnections, setWalletStatus, stateChanges } = createDappConnections({
      permissions: [{ ...scope, accountIds: [EIP155_ACCOUNT_A] }],
    });
    expect(dappConnections.openConnection(scope, "eip155:1").accounts).toHaveLength(1);

    setWalletStatus("locked");
    expect(dappConnections.getConnectionState(scope, "eip155:1").accounts).toEqual([]);
    expect(dappConnections.openConnection(scope, "eip155:1").accounts).toEqual([]);
    expect(stateChanges).toEqual([]);

    dappConnections.refreshAccountsForOpenConnections();
    expect(stateChanges).toEqual([
      {
        scope,
        state: { chainRef: "eip155:1", accounts: [] },
        changedFields: { chainRef: false, accounts: true },
      },
    ]);
  });

  it("changes the site's chain without changing its accounts and restores it when reopened", async () => {
    const scope = { origin: "https://dapp.example", namespace: "eip155" } as const;
    const initial = selection(scope.origin, scope.namespace, "eip155:1");
    const next = { ...initial, chainRef: "eip155:10" };
    const permission: PermissionRecord = { ...scope, accountIds: [EIP155_ACCOUNT_A] };
    const { dappConnections, stateChanges } = createDappConnections({
      networkSelections: [initial],
      permissions: [permission],
    });

    expect(dappConnections.openConnection(scope, "eip155:1")).toEqual({
      chainRef: "eip155:1",
      accounts: [ADDRESS],
    });

    await dappConnections.selectNetwork(next);
    const selectedState = {
      chainRef: "eip155:10",
      accounts: [ADDRESS],
    } as const;
    expect(dappConnections.getConnectionState(scope, "eip155:1")).toEqual(selectedState);

    dappConnections.closeConnection(scope);
    expect(dappConnections.openConnection(scope, "eip155:1")).toEqual(selectedState);
    expect(stateChanges).toEqual([
      {
        scope,
        state: selectedState,
        changedFields: { chainRef: true, accounts: false },
      },
    ]);
  });
});
