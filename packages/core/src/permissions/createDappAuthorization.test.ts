import { describe, expect, it } from "vitest";
import type { AccountId } from "../accounts/accountId.js";
import { Approvals } from "../approvals/Approvals.js";
import type { ApprovalDraft } from "../approvals/types.js";
import { type DappConnectionStateChanged, DappConnections } from "../dappConnections/DappConnections.js";
import type { DappConnectionScope, DappNetworkSelectionRecord } from "../dappConnections/persistence.js";
import { ACCOUNT_ID, ADDRESS, createAccounts, createNetworks } from "../namespaces/eip155/__tests__/fixtures.js";
import type { ChainRef } from "../networks/chainRef.js";
import type { Network } from "../networks/types.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import { WalletLockedError } from "../wallet/errors.js";
import type { WalletStatus } from "../wallet/Wallet.js";
import { createDappAuthorization } from "./createDappAuthorization.js";
import { Permissions, type PermissionsChanged } from "./Permissions.js";
import type { PermissionRecord } from "./persistence.js";

const EIP155_ACCOUNT_A = ACCOUNT_ID;
const EIP155_ACCOUNT_B = "eip155:7e5f4552091a69125d5dfcb7b8c2659029395bdf";

const installedNetworks = [
  {
    chainRef: "eip155:1",
    namespace: "eip155",
    source: "builtin",
    name: "Ethereum",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  {
    chainRef: "eip155:10",
    namespace: "eip155",
    source: "builtin",
    name: "Optimism",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
] as const satisfies readonly Network[];

const scope = (origin: string) => ({ origin, namespace: "eip155" }) as const;

const permission = (
  scope: DappConnectionScope,
  accountIds: readonly [AccountId, ...AccountId[]],
): PermissionRecord => ({
  ...scope,
  accountIds,
});

const selection = (scope: DappConnectionScope, chainRef: ChainRef): DappNetworkSelectionRecord => ({
  ...scope,
  chainRef,
});

const approval = (
  type: "accountAccess" | "sign" | "sendTransaction" | "switchNetwork",
  inputScope: ReturnType<typeof scope>,
): ApprovalDraft => {
  const account = {
    accountId: EIP155_ACCOUNT_A,
    chainRef: "eip155:1",
    canonicalAddress: ADDRESS,
    displayAddress: "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c",
  };
  switch (type) {
    case "accountAccess":
      return { type, ...inputScope, request: { selectableAccounts: [account] } };
    case "sign":
      return {
        type,
        ...inputScope,
        accountId: account.accountId,
        request: { type: "personalMessage", account, message: { format: "utf8", value: "hello" } },
      };
    case "sendTransaction":
      return {
        type,
        ...inputScope,
        accountId: account.accountId,
        request: {
          namespace: "eip155",
          chainRef: account.chainRef,
          accountId: account.accountId,
          initiator: { type: "dapp", origin: inputScope.origin },
          transaction: {
            from: account.canonicalAddress,
            to: null,
            value: "0x0",
            data: "0x",
            gas: "0x5208",
            nonce: "0x0",
            type: "legacy",
            gasPrice: "0x1",
          },
        },
      };
    case "switchNetwork":
      return {
        type,
        ...inputScope,
        request: { currentNetwork: installedNetworks[0], targetNetwork: installedNetworks[1] },
      };
  }
};

const createHarness = (
  input: Readonly<{
    permissions?: readonly PermissionRecord[];
    networkSelections?: readonly DappNetworkSelectionRecord[];
    walletStatus?: WalletStatus;
    approvals?: readonly ApprovalDraft[];
  }> = {},
) => {
  const commits: PersistenceChange[][] = [];
  const permissionEvents: PermissionsChanged[] = [];
  const connectionEvents: DappConnectionStateChanged[] = [];
  let walletStatus = input.walletStatus ?? "unlocked";
  let commitFailure: Error | null = null;

  const mutations = createCoreMutationQueue({
    commit: async (changes) => {
      if (commitFailure) throw commitFailure;
      commits.push([...changes]);
    },
  });
  const accounts = createAccounts();
  const permissions = new Permissions({
    bootstrap: { records: input.permissions ?? [] },
    accounts,
  });
  const dappConnections = new DappConnections({
    bootstrap: { networkSelections: input.networkSelections ?? [] },
    accounts,
    networks: createNetworks(),
    permissions,
    wallet: { getStatus: () => walletStatus },
    mutations,
    publishStateChanged: (change) => connectionEvents.push(change),
  });
  const approvals = new Approvals({
    time: { now: () => 1, schedule: () => () => undefined },
    publishChanged: () => undefined,
  });
  for (const draft of input.approvals ?? []) {
    void approvals.request(draft).decision.catch(() => undefined);
  }
  const authorization = createDappAuthorization({
    mutations,
    wallet: { getStatus: () => walletStatus },
    accounts,
    permissions,
    dappConnections,
    getConnectionState: (scope) => dappConnections.getConnectionState(scope, "eip155:1"),
    approvals,
    publishPermissionsChanged: (change) => permissionEvents.push(change),
  });

  return {
    authorization,
    commits,
    connectionEvents,
    dappConnections,
    pendingApprovals: () => approvals.list().map(({ type, origin }) => ({ type, origin })),
    permissionEvents,
    permissions,
    setCommitFailure: (failure: Error | null) => {
      commitFailure = failure;
    },
    setWalletStatus: (status: WalletStatus) => {
      walletStatus = status;
    },
  };
};

describe("createDappAuthorization", () => {
  it("grants account access on the site's network and preserves an existing site selection", async () => {
    const dappScope = scope("https://dapp.example");
    const grant = permission(dappScope, [EIP155_ACCOUNT_A]);
    const harness = createHarness();

    harness.dappConnections.openConnection(dappScope, "eip155:1");
    await harness.authorization.permissions.setAccounts(grant);

    expect(harness.commits).toEqual([
      [
        { persistenceType: "permission", operation: "put", value: grant },
        { persistenceType: "dappNetworkSelection", operation: "put", value: selection(dappScope, "eip155:1") },
      ],
    ]);
    expect(harness.permissions.get(dappScope)).toEqual(grant);
    expect(harness.dappConnections.getNetworkSelection(dappScope)).toEqual(selection(dappScope, "eip155:1"));
    expect(harness.dappConnections.getConnectionState(dappScope, "eip155:1")).toEqual({
      chainRef: "eip155:1",
      accounts: [ADDRESS],
    });
    expect(harness.permissionEvents).toEqual([{ type: "permissionsChanged", scopes: [dappScope] }]);
    expect(harness.connectionEvents).toEqual([
      {
        scope: dappScope,
        state: { chainRef: "eip155:1", accounts: [ADDRESS] },
        changedFields: { chainRef: false, accounts: true },
      },
    ]);

    const switched = createHarness({ networkSelections: [selection(dappScope, "eip155:10")] });
    switched.dappConnections.openConnection(dappScope, "eip155:1");
    await switched.authorization.permissions.setAccounts(grant);
    expect(switched.dappConnections.getNetworkSelection(dappScope)).toEqual(selection(dappScope, "eip155:10"));
    expect(switched.dappConnections.getConnectionState(dappScope, "eip155:1")).toEqual({
      chainRef: "eip155:10",
      accounts: [ADDRESS],
    });
    expect(switched.connectionEvents).toEqual([
      {
        scope: dappScope,
        state: { chainRef: "eip155:10", accounts: [ADDRESS] },
        changedFields: { chainRef: false, accounts: true },
      },
    ]);
  });

  it("leaves a first grant inactive while locked or after a failed commit", async () => {
    const dappScope = scope("https://dapp.example");
    const grant = permission(dappScope, [EIP155_ACCOUNT_A]);
    const harness = createHarness({ walletStatus: "locked" });
    harness.dappConnections.openConnection(dappScope, "eip155:1");

    await expect(harness.authorization.permissions.setAccounts(grant)).rejects.toBeInstanceOf(WalletLockedError);
    harness.setWalletStatus("unlocked");
    const failure = new Error("commit failed");
    harness.setCommitFailure(failure);
    await expect(harness.authorization.permissions.setAccounts(grant)).rejects.toBe(failure);

    expect(harness.commits).toEqual([]);
    expect(harness.permissions.get(dappScope)).toBeNull();
    expect(harness.dappConnections.getNetworkSelection(dappScope)).toBeNull();
    expect(harness.permissionEvents).toEqual([]);
    expect(harness.connectionEvents).toEqual([]);
  });

  it("revokes one permission, refreshes its active accounts, and cancels dependent approvals", async () => {
    const dappScope = scope("https://dapp.example");
    const otherScope = scope("https://other.example");
    const grant = permission(dappScope, [EIP155_ACCOUNT_A]);
    const harness = createHarness({
      permissions: [grant],
      networkSelections: [selection(dappScope, "eip155:10")],
      approvals: [
        approval("accountAccess", dappScope),
        approval("sign", dappScope),
        approval("sendTransaction", dappScope),
        approval("switchNetwork", dappScope),
        approval("accountAccess", otherScope),
      ],
    });

    harness.dappConnections.openConnection(dappScope, "eip155:1");
    await harness.authorization.permissions.revoke(dappScope);

    expect(harness.commits).toEqual([[{ persistenceType: "permission", operation: "remove", key: dappScope }]]);
    expect(harness.dappConnections.getNetworkSelection(dappScope)).toEqual(selection(dappScope, "eip155:10"));
    expect(harness.dappConnections.getConnectionState(dappScope, "eip155:1")).toEqual({
      chainRef: "eip155:10",
      accounts: [],
    });
    expect(harness.pendingApprovals()).toEqual([
      { type: "switchNetwork", origin: dappScope.origin },
      { type: "accountAccess", origin: otherScope.origin },
    ]);
    expect(harness.permissionEvents).toEqual([{ type: "permissionsChanged", scopes: [dappScope] }]);
    expect(harness.connectionEvents).toEqual([
      {
        scope: dappScope,
        state: { chainRef: "eip155:10", accounts: [] },
        changedFields: { chainRef: false, accounts: true },
      },
    ]);
  });

  it("disconnects an origin while retaining its chain and other origins' permissions", async () => {
    const dappScope = scope("https://dapp.example");
    const otherScope = scope("https://other.example");
    const grant = permission(dappScope, [EIP155_ACCOUNT_A]);
    const otherGrant = permission(otherScope, [EIP155_ACCOUNT_B]);
    const harness = createHarness({
      permissions: [grant, otherGrant],
      networkSelections: [selection(dappScope, "eip155:10"), selection(otherScope, "eip155:1")],
      approvals: [
        approval("accountAccess", dappScope),
        approval("switchNetwork", dappScope),
        approval("accountAccess", otherScope),
      ],
    });

    harness.dappConnections.openConnection(otherScope, "eip155:1");
    harness.dappConnections.openConnection(dappScope, "eip155:1");
    await harness.authorization.permissions.disconnectOrigin({ origin: dappScope.origin });

    expect(harness.commits).toHaveLength(1);
    expect(harness.commits[0]).toEqual([{ persistenceType: "permission", operation: "remove", key: dappScope }]);
    expect(harness.permissions.get(dappScope)).toBeNull();
    expect(harness.permissions.get(otherScope)).toEqual(otherGrant);
    expect(harness.dappConnections.getNetworkSelection(dappScope)).toEqual(selection(dappScope, "eip155:10"));
    expect(harness.dappConnections.getNetworkSelection(otherScope)).toEqual(selection(otherScope, "eip155:1"));
    expect(harness.dappConnections.isConnectionOpen(dappScope)).toBe(true);
    expect(harness.dappConnections.getConnectionState(dappScope, "eip155:1")).toEqual({
      chainRef: "eip155:10",
      accounts: [],
    });
    expect(harness.dappConnections.getConnectionState(otherScope, "eip155:1")).toEqual({
      chainRef: "eip155:1",
      accounts: ["0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"],
    });
    expect(harness.connectionEvents).toEqual([
      {
        scope: dappScope,
        state: { chainRef: "eip155:10", accounts: [] },
        changedFields: { chainRef: false, accounts: true },
      },
    ]);
    expect(harness.pendingApprovals()).toEqual([{ type: "accountAccess", origin: otherScope.origin }]);
  });

  it("closes an active scope and cancels all of its approvals without deleting authorization", () => {
    const dappScope = scope("https://dapp.example");
    const otherScope = scope("https://other.example");
    const grant = permission(dappScope, [EIP155_ACCOUNT_A]);
    const dappSelection = selection(dappScope, "eip155:10");
    const harness = createHarness({
      permissions: [grant],
      networkSelections: [dappSelection],
      approvals: [
        approval("accountAccess", dappScope),
        approval("switchNetwork", dappScope),
        approval("accountAccess", otherScope),
      ],
    });

    harness.dappConnections.openConnection(dappScope, "eip155:1");
    harness.authorization.closeConnection(dappScope);
    harness.authorization.closeConnection(dappScope);

    expect(harness.commits).toEqual([]);
    expect(harness.permissions.get(dappScope)).toEqual(grant);
    expect(harness.dappConnections.getNetworkSelection(dappScope)).toEqual(dappSelection);
    expect(harness.dappConnections.isConnectionOpen(dappScope)).toBe(false);
    expect(harness.connectionEvents).toEqual([]);
    expect(harness.pendingApprovals()).toEqual([{ type: "accountAccess", origin: otherScope.origin }]);
  });
});
