import { describe, expect, it } from "vitest";
import type { PermissionRecord } from "../permissions/persistence.js";
import {
  createDappConnections,
  EIP155_ACCOUNT_A,
  EIP155_ACCOUNT_B,
  SOLANA_ACCOUNT,
  selection,
} from "./__tests__/DappConnections.testSupport.js";
import type { DappConnectionState } from "./DappConnections.js";

describe("DappConnections active state", () => {
  it("does not persist passive state and captures the Wallet selection when a scope opens", () => {
    const scope = { origin: "https://dapp.example", namespace: "eip155" } as const;
    const { commits, dappConnections, events, setWalletSelection } = createDappConnections();

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
    expect(events).toEqual([]);
  });

  it("refreshes every active state before publishing stable ordered changes", () => {
    const firstScope = { origin: "https://a.example", namespace: "eip155" } as const;
    const secondScope = { origin: "https://b.example", namespace: "eip155" } as const;
    const firstPermission: PermissionRecord = { ...firstScope, accountIds: [EIP155_ACCOUNT_A] };
    const secondPermission: PermissionRecord = { ...secondScope, accountIds: [EIP155_ACCOUNT_B] };
    const statesAtPublication: Array<{ first: DappConnectionState; second: DappConnectionState }> = [];
    const { dappConnections, events, setWalletStatus } = createDappConnections({
      walletStatus: "locked",
      permissions: [firstPermission, secondPermission],
      onConnectionStateChanged: (_change, connections) => {
        statesAtPublication.push({
          first: connections.getConnectionState(firstScope),
          second: connections.getConnectionState(secondScope),
        });
      },
    });

    dappConnections.openConnection(secondScope);
    dappConnections.openConnection(firstScope);
    setWalletStatus("unlocked");
    dappConnections.refreshActiveConnectionStates();

    const firstAddress = `eip155:1/${EIP155_ACCOUNT_A}`;
    const secondAddress = `eip155:1/${EIP155_ACCOUNT_B}`;
    expect(events).toEqual([
      {
        scope: firstScope,
        state: { chainRef: "eip155:1", accounts: [firstAddress] },
        changedFields: { chainRef: false, accounts: true },
      },
      {
        scope: secondScope,
        state: { chainRef: "eip155:1", accounts: [secondAddress] },
        changedFields: { chainRef: false, accounts: true },
      },
    ]);
    expect(statesAtPublication).toEqual([
      {
        first: { chainRef: "eip155:1", accounts: [firstAddress] },
        second: { chainRef: "eip155:1", accounts: [secondAddress] },
      },
      {
        first: { chainRef: "eip155:1", accounts: [firstAddress] },
        second: { chainRef: "eip155:1", accounts: [secondAddress] },
      },
    ]);

    events.splice(0);
    dappConnections.refreshActiveConnectionStates();
    expect(events).toEqual([]);
  });

  it("refreshes account projection when a permission changes", () => {
    const scope = { origin: "https://dapp.example", namespace: "eip155" } as const;
    const initial: PermissionRecord = { ...scope, accountIds: [EIP155_ACCOUNT_A] };
    const { dappConnections, events, removePermission, setPermission } = createDappConnections({
      permissions: [initial],
    });

    dappConnections.openConnection(scope);
    setPermission({ ...initial, accountIds: [EIP155_ACCOUNT_A, EIP155_ACCOUNT_B] });
    dappConnections.refreshActiveConnectionStates();
    expect(events).toEqual([
      {
        scope,
        state: {
          chainRef: "eip155:1",
          accounts: [`eip155:1/${EIP155_ACCOUNT_A}`, `eip155:1/${EIP155_ACCOUNT_B}`],
        },
        changedFields: { chainRef: false, accounts: true },
      },
    ]);

    events.splice(0);
    removePermission(scope);
    dappConnections.refreshActiveConnectionStates();
    expect(events).toEqual([
      {
        scope,
        state: { chainRef: "eip155:1", accounts: [] },
        changedFields: { chainRef: false, accounts: true },
      },
    ]);
  });

  it("projects a non-EIP active scope through the generic Accounts port", () => {
    const scope = { origin: "https://dapp.example", namespace: "solana" } as const;
    const permission: PermissionRecord = { ...scope, accountIds: [SOLANA_ACCOUNT] };
    const { dappConnections, events, setWalletStatus } = createDappConnections({
      walletStatus: "locked",
      permissions: [permission],
    });

    expect(dappConnections.openConnection(scope)).toEqual({ chainRef: "solana:mainnet", accounts: [] });

    setWalletStatus("unlocked");
    dappConnections.refreshActiveConnectionStates();

    expect(events).toEqual([
      {
        scope,
        state: { chainRef: "solana:mainnet", accounts: [`solana:mainnet/${SOLANA_ACCOUNT}`] },
        changedFields: { chainRef: false, accounts: true },
      },
    ]);
  });

  it("activates a persisted selection and falls back after coordinated removal", async () => {
    const scope = { origin: "https://dapp.example", namespace: "eip155" } as const;
    const initial = selection(scope.origin, scope.namespace, "eip155:1");
    const next = { ...initial, chainRef: "eip155:10" };
    const permission: PermissionRecord = { ...scope, accountIds: [EIP155_ACCOUNT_A] };
    const { dappConnections, events, removePermission, setWalletSelection } = createDappConnections({
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
    expect(events).toEqual([
      {
        scope,
        state: { chainRef: "eip155:10", accounts: [`eip155:10/${EIP155_ACCOUNT_A}`] },
        changedFields: { chainRef: true, accounts: true },
      },
    ]);

    await dappConnections.selectNetwork(next);
    expect(events).toHaveLength(1);

    setWalletSelection("eip155", "eip155:1");
    removePermission(scope);
    const removal = dappConnections.prepareRemoveOriginSelections(scope.origin);
    if (!removal) throw new Error("Expected a selection removal draft");
    dappConnections.applyCommittedUpdate(removal);
    dappConnections.refreshActiveConnectionStates(removal.changedScopes);

    expect(dappConnections.getConnectionState(scope)).toEqual({ chainRef: "eip155:1", accounts: [] });
    expect(events.at(-1)).toEqual({
      scope,
      state: { chainRef: "eip155:1", accounts: [] },
      changedFields: { chainRef: true, accounts: true },
    });
  });

  it("switches a captured scope to a matching persisted selection without publishing a false change", async () => {
    const scope = { origin: "https://dapp.example", namespace: "eip155" } as const;
    const { dappConnections, events, setWalletSelection } = createDappConnections();

    setWalletSelection("eip155", "eip155:10");
    dappConnections.openConnection(scope);
    await dappConnections.selectNetwork(selection(scope.origin, scope.namespace, "eip155:10"));
    expect(events).toEqual([]);

    setWalletSelection("eip155", "eip155:1");
    const removal = dappConnections.prepareRemoveOriginSelections(scope.origin);
    if (!removal) throw new Error("Expected a selection removal draft");
    dappConnections.applyCommittedUpdate(removal);
    dappConnections.refreshActiveConnectionStates(removal.changedScopes);

    expect(dappConnections.getConnectionState(scope)).toEqual({ chainRef: "eip155:1", accounts: [] });
    expect(events).toEqual([
      {
        scope,
        state: { chainRef: "eip155:1", accounts: [] },
        changedFields: { chainRef: true, accounts: false },
      },
    ]);
  });

  it("stops deriving and publishing state after a scope closes", () => {
    const scope = { origin: "https://dapp.example", namespace: "eip155" } as const;
    const permission: PermissionRecord = { ...scope, accountIds: [EIP155_ACCOUNT_A] };
    const { dappConnections, events, setWalletStatus } = createDappConnections({ permissions: [permission] });

    dappConnections.openConnection(scope);
    dappConnections.closeConnection(scope);
    setWalletStatus("locked");
    dappConnections.refreshActiveConnectionStates();

    expect(dappConnections.isConnectionOpen(scope)).toBe(false);
    expect(events).toEqual([]);
  });
});
