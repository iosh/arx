import { describe, expect, it } from "vitest";
import type { PermissionRecord } from "../permissions/persistence.js";
import {
  createDappConnections,
  EIP155_ACCOUNT_A,
  EIP155_ACCOUNT_B,
  SOLANA_ACCOUNT,
  selection,
} from "./__tests__/DappConnections.testSupport.js";

describe("DappConnections active state", () => {
  it("does not persist passive state and captures the Wallet selection when a scope opens", () => {
    const scope = { origin: "https://dapp.example", namespace: "eip155" } as const;
    const { commits, dappConnections, setWalletSelection } = createDappConnections();

    expect(dappConnections.getConnectionState(scope)).toEqual({ chainRef: "eip155:1", accounts: [] });
    expect(dappConnections.isConnectionOpen(scope)).toBe(false);

    setWalletSelection("eip155", "eip155:10");
    expect(dappConnections.getConnectionState(scope)).toEqual({ chainRef: "eip155:10", accounts: [] });

    expect(dappConnections.openConnection(scope)).toEqual({ chainRef: "eip155:10", accounts: [] });
    expect(dappConnections.isConnectionOpen(scope)).toBe(true);
    expect(commits).toEqual([]);

    setWalletSelection("eip155", "eip155:1");
    dappConnections.refreshAccountsForOpenConnections();

    expect(dappConnections.getConnectionState(scope)).toEqual({ chainRef: "eip155:10", accounts: [] });
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

    dappConnections.openConnection(secondScope);
    dappConnections.openConnection(firstScope);
    expect(stateChanges).toEqual([]);

    setWalletStatus("unlocked");
    dappConnections.refreshAccountsForOpenConnections();

    const firstState = {
      chainRef: "eip155:1",
      accounts: [`eip155:1/${EIP155_ACCOUNT_A}`],
    } as const;
    const secondState = {
      chainRef: "eip155:1",
      accounts: [`eip155:1/${EIP155_ACCOUNT_B}`],
    } as const;

    expect(dappConnections.getConnectionState(firstScope)).toEqual(firstState);
    expect(dappConnections.getConnectionState(secondScope)).toEqual(secondState);
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

  it("refreshes an active account projection after permission changes", () => {
    const scope = { origin: "https://dapp.example", namespace: "eip155" } as const;
    const initial: PermissionRecord = { ...scope, accountIds: [EIP155_ACCOUNT_A] };
    const { dappConnections, removePermission, setPermission } = createDappConnections({
      permissions: [initial],
    });

    dappConnections.openConnection(scope);
    setPermission({ ...initial, accountIds: [EIP155_ACCOUNT_A, EIP155_ACCOUNT_B] });
    dappConnections.refreshAccountsForOpenConnections();
    expect(dappConnections.getConnectionState(scope)).toEqual({
      chainRef: "eip155:1",
      accounts: [`eip155:1/${EIP155_ACCOUNT_A}`, `eip155:1/${EIP155_ACCOUNT_B}`],
    });

    removePermission(scope);
    dappConnections.refreshAccountsForOpenConnections();
    expect(dappConnections.getConnectionState(scope)).toEqual({ chainRef: "eip155:1", accounts: [] });
  });

  it("projects a non-EIP active scope through the generic Accounts port", () => {
    const scope = { origin: "https://dapp.example", namespace: "solana" } as const;
    const permission: PermissionRecord = { ...scope, accountIds: [SOLANA_ACCOUNT] };
    const { dappConnections, setWalletStatus } = createDappConnections({
      walletStatus: "locked",
      permissions: [permission],
    });

    expect(dappConnections.openConnection(scope)).toEqual({ chainRef: "solana:mainnet", accounts: [] });

    setWalletStatus("unlocked");
    dappConnections.refreshAccountsForOpenConnections();

    expect(dappConnections.getConnectionState(scope)).toEqual({
      chainRef: "solana:mainnet",
      accounts: [`solana:mainnet/${SOLANA_ACCOUNT}`],
    });
  });

  it("activates a persisted selection and falls back after coordinated removal", async () => {
    const scope = { origin: "https://dapp.example", namespace: "eip155" } as const;
    const initial = selection(scope.origin, scope.namespace, "eip155:1");
    const next = { ...initial, chainRef: "eip155:10" };
    const permission: PermissionRecord = { ...scope, accountIds: [EIP155_ACCOUNT_A] };
    const { dappConnections, removePermission, setWalletSelection, stateChanges } = createDappConnections({
      networkSelections: [initial],
      permissions: [permission],
    });

    expect(dappConnections.openConnection(scope)).toEqual({
      chainRef: "eip155:1",
      accounts: [`eip155:1/${EIP155_ACCOUNT_A}`],
    });

    await dappConnections.selectNetwork(next);
    const selectedState = {
      chainRef: "eip155:10",
      accounts: [`eip155:10/${EIP155_ACCOUNT_A}`],
    } as const;
    expect(dappConnections.getConnectionState(scope)).toEqual(selectedState);

    setWalletSelection("eip155", "eip155:1");
    removePermission(scope);
    const removal = dappConnections.prepareRemoveOriginSelections(scope.origin);
    if (!removal) throw new Error("Expected a selection removal draft");
    removal.activate();
    removal.publish();

    const disconnectedState = { chainRef: "eip155:1", accounts: [] } as const;
    expect(dappConnections.getConnectionState(scope)).toEqual(disconnectedState);
    expect(stateChanges).toEqual([
      {
        scope,
        state: selectedState,
        changedFields: { chainRef: true, accounts: true },
      },
      {
        scope,
        state: disconnectedState,
        changedFields: { chainRef: true, accounts: true },
      },
    ]);
  });

  it("switches a captured scope to a matching persisted selection and falls back after removal", async () => {
    const scope = { origin: "https://dapp.example", namespace: "eip155" } as const;
    const { dappConnections, setWalletSelection } = createDappConnections();

    setWalletSelection("eip155", "eip155:10");
    dappConnections.openConnection(scope);
    await dappConnections.selectNetwork(selection(scope.origin, scope.namespace, "eip155:10"));
    expect(dappConnections.getConnectionState(scope)).toEqual({ chainRef: "eip155:10", accounts: [] });

    setWalletSelection("eip155", "eip155:1");
    const removal = dappConnections.prepareRemoveOriginSelections(scope.origin);
    if (!removal) throw new Error("Expected a selection removal draft");
    removal.activate();

    expect(dappConnections.getConnectionState(scope)).toEqual({ chainRef: "eip155:1", accounts: [] });
  });
});
