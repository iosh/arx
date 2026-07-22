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
    dappConnections.refreshActiveConnectionStates();

    expect(dappConnections.getConnectionState(scope)).toEqual({ chainRef: "eip155:10", accounts: [] });
  });

  it("refreshes every active connection", () => {
    const firstScope = { origin: "https://a.example", namespace: "eip155" } as const;
    const secondScope = { origin: "https://b.example", namespace: "eip155" } as const;
    const firstPermission: PermissionRecord = { ...firstScope, accountIds: [EIP155_ACCOUNT_A] };
    const secondPermission: PermissionRecord = { ...secondScope, accountIds: [EIP155_ACCOUNT_B] };
    const { dappConnections, setWalletStatus } = createDappConnections({
      walletStatus: "locked",
      permissions: [firstPermission, secondPermission],
    });

    dappConnections.openConnection(secondScope);
    dappConnections.openConnection(firstScope);
    setWalletStatus("unlocked");
    dappConnections.refreshActiveConnectionStates();

    expect(dappConnections.getConnectionState(firstScope)).toEqual({
      chainRef: "eip155:1",
      accounts: [`eip155:1/${EIP155_ACCOUNT_A}`],
    });
    expect(dappConnections.getConnectionState(secondScope)).toEqual({
      chainRef: "eip155:1",
      accounts: [`eip155:1/${EIP155_ACCOUNT_B}`],
    });
  });

  it("refreshes an active account projection after permission changes", () => {
    const scope = { origin: "https://dapp.example", namespace: "eip155" } as const;
    const initial: PermissionRecord = { ...scope, accountIds: [EIP155_ACCOUNT_A] };
    const { dappConnections, removePermission, setPermission } = createDappConnections({
      permissions: [initial],
    });

    dappConnections.openConnection(scope);
    setPermission({ ...initial, accountIds: [EIP155_ACCOUNT_A, EIP155_ACCOUNT_B] });
    dappConnections.refreshActiveConnectionStates();
    expect(dappConnections.getConnectionState(scope)).toEqual({
      chainRef: "eip155:1",
      accounts: [`eip155:1/${EIP155_ACCOUNT_A}`, `eip155:1/${EIP155_ACCOUNT_B}`],
    });

    removePermission(scope);
    dappConnections.refreshActiveConnectionStates();
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
    dappConnections.refreshActiveConnectionStates();

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
    const { dappConnections, removePermission, setWalletSelection } = createDappConnections({
      networkSelections: [initial],
      permissions: [permission],
    });

    expect(dappConnections.openConnection(scope)).toEqual({
      chainRef: "eip155:1",
      accounts: [`eip155:1/${EIP155_ACCOUNT_A}`],
    });

    await dappConnections.selectNetwork(next);
    expect(dappConnections.getConnectionState(scope)).toEqual({
      chainRef: "eip155:10",
      accounts: [`eip155:10/${EIP155_ACCOUNT_A}`],
    });

    setWalletSelection("eip155", "eip155:1");
    removePermission(scope);
    const removal = dappConnections.prepareRemoveOriginSelections(scope.origin);
    if (!removal) throw new Error("Expected a selection removal draft");
    dappConnections.applyCommittedUpdate(removal);
    dappConnections.refreshActiveConnectionStates(removal.changedScopes);

    expect(dappConnections.getConnectionState(scope)).toEqual({ chainRef: "eip155:1", accounts: [] });
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
    dappConnections.applyCommittedUpdate(removal);
    dappConnections.refreshActiveConnectionStates(removal.changedScopes);

    expect(dappConnections.getConnectionState(scope)).toEqual({ chainRef: "eip155:1", accounts: [] });
  });
});
