import { describe, expect, it } from "vitest";
import type { AccountId } from "../accounts/accountId.js";
import type { Account } from "../accounts/types.js";
import type { Approvals } from "../approvals/Approvals.js";
import type { Approval } from "../approvals/types.js";
import { DappConnections } from "../dappConnections/DappConnections.js";
import type { DappConnectionScope, DappNetworkSelectionRecord } from "../dappConnections/persistence.js";
import type { ChainRef } from "../networks/chainRef.js";
import type { Network, NetworksReader } from "../networks/types.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import { WalletLockedError } from "../wallet/errors.js";
import type { WalletStatus } from "../wallet/Wallet.js";
import { createDappAuthorization } from "./createDappAuthorization.js";
import { Permissions, type PermissionsChanged } from "./Permissions.js";
import type { PermissionRecord } from "./persistence.js";

const EIP155_ACCOUNT_A = "eip155:0000000000000000000000000000000000000001" as AccountId;
const EIP155_ACCOUNT_B = "eip155:0000000000000000000000000000000000000002" as AccountId;

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
    source: "custom",
    name: "Optimism",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
] as const satisfies readonly Network[];

const networksByChainRef = new Map(installedNetworks.map((network) => [network.chainRef, network]));

const account = (accountId: AccountId): Account => ({
  accountId,
  namespace: "eip155",
  origin: { type: "hd", hdKeyringId: "keyring-eip155", derivationIndex: 0 },
  hidden: false,
  selected: false,
  createdAt: 1,
});

const scope = (origin: string): DappConnectionScope => ({ origin, namespace: "eip155" });

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

const approval = (approvalId: string, type: Approval["type"], scope: DappConnectionScope): Approval =>
  ({ approvalId, type, ...scope, createdAt: 1, request: {} }) as Approval;

const createHarness = (
  input: Readonly<{
    permissions?: readonly PermissionRecord[];
    networkSelections?: readonly DappNetworkSelectionRecord[];
    walletStatus?: WalletStatus;
    walletChainRef?: ChainRef;
    approvals?: readonly Approval[];
  }> = {},
) => {
  const accountsById = new Map(
    [EIP155_ACCOUNT_A, EIP155_ACCOUNT_B].map((accountId) => [accountId, account(accountId)]),
  );
  const commits: PersistenceChange[][] = [];
  const permissionEvents: PermissionsChanged[] = [];
  const cancelledApprovalIds: string[][] = [];
  let walletStatus = input.walletStatus ?? "unlocked";
  let commitFailure: Error | null = null;
  let pendingApprovals = [...(input.approvals ?? [])];

  const mutations = createCoreMutationQueue({
    commit: async (changes) => {
      if (commitFailure) throw commitFailure;
      commits.push([...changes]);
    },
  });
  const permissions = new Permissions({
    bootstrap: { records: input.permissions ?? [] },
    accounts: { getAccount: (accountId) => accountsById.get(accountId) ?? null },
  });
  const networks = {
    get: (chainRef: ChainRef) => networksByChainRef.get(chainRef) ?? null,
    getSelection: () => {
      const selectedChainRef = input.walletChainRef ?? "eip155:1";
      return {
        selectedNamespace: "eip155",
        selectedChainRef,
        selectedChainRefByNamespace: { eip155: selectedChainRef },
      };
    },
  } satisfies Pick<NetworksReader, "get" | "getSelection">;
  const dappConnections = new DappConnections({
    bootstrap: { networkSelections: input.networkSelections ?? [] },
    accounts: {
      getAddress: ({ accountId, chainRef }) => ({
        accountId,
        chainRef,
        canonicalAddress: `${chainRef}/${accountId}`,
        displayAddress: `${chainRef}/${accountId}`,
      }),
    },
    networks,
    permissions,
    wallet: { getStatus: () => walletStatus },
    mutations,
  });
  const approvals = {
    list: (): readonly Approval[] => pendingApprovals,
    cancel: (approvalIds: readonly string[]) => {
      if (approvalIds.length === 0) return;

      cancelledApprovalIds.push([...approvalIds]);
      const cancelled = new Set(approvalIds);
      pendingApprovals = pendingApprovals.filter(({ approvalId }) => !cancelled.has(approvalId));
    },
  } satisfies Pick<Approvals, "list" | "cancel">;
  const authorization = createDappAuthorization({
    mutations,
    wallet: { getStatus: () => walletStatus },
    networks,
    permissions,
    dappConnections,
    approvals,
    publishPermissionsChanged: (change) => permissionEvents.push(change),
  });

  return {
    authorization,
    cancelledApprovalIds,
    commits,
    dappConnections,
    pendingApprovals: () => pendingApprovals,
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
  it("commits a first grant with the current Wallet selection", async () => {
    const dappScope = scope("https://dapp.example");
    const grant = permission(dappScope, [EIP155_ACCOUNT_A]);
    const harness = createHarness({ walletChainRef: "eip155:10" });

    harness.dappConnections.openConnection(dappScope);
    await harness.authorization.permissions.setAccounts(grant);

    expect(harness.commits).toEqual([
      [
        { persistenceType: "permission", operation: "put", value: grant },
        { persistenceType: "dappNetworkSelection", operation: "put", value: selection(dappScope, "eip155:10") },
      ],
    ]);
    expect(harness.permissions.get(dappScope)).toEqual(grant);
    expect(harness.dappConnections.getNetworkSelection(dappScope)).toEqual(selection(dappScope, "eip155:10"));
    expect(harness.dappConnections.getConnectionState(dappScope)).toEqual({
      chainRef: "eip155:10",
      accounts: [`eip155:10/${EIP155_ACCOUNT_A}`],
    });
    expect(harness.permissionEvents).toEqual([{ type: "permissionsChanged", scopes: [dappScope] }]);
  });

  it("leaves a first grant inactive while locked or after a failed commit", async () => {
    const dappScope = scope("https://dapp.example");
    const grant = permission(dappScope, [EIP155_ACCOUNT_A]);
    const harness = createHarness({ walletStatus: "locked" });

    await expect(harness.authorization.permissions.setAccounts(grant)).rejects.toBeInstanceOf(WalletLockedError);
    harness.setWalletStatus("unlocked");
    const failure = new Error("commit failed");
    harness.setCommitFailure(failure);
    await expect(harness.authorization.permissions.setAccounts(grant)).rejects.toBe(failure);

    expect(harness.commits).toEqual([]);
    expect(harness.permissions.get(dappScope)).toBeNull();
    expect(harness.dappConnections.getNetworkSelection(dappScope)).toBeNull();
    expect(harness.permissionEvents).toEqual([]);
  });

  it("revokes one permission, refreshes its active accounts, and cancels dependent approvals", async () => {
    const dappScope = scope("https://dapp.example");
    const otherScope = scope("https://other.example");
    const grant = permission(dappScope, [EIP155_ACCOUNT_A]);
    const harness = createHarness({
      permissions: [grant],
      networkSelections: [selection(dappScope, "eip155:10")],
      approvals: [
        approval("access", "accountAccess", dappScope),
        approval("sign", "sign", dappScope),
        approval("send", "sendTransaction", dappScope),
        approval("switch", "switchNetwork", dappScope),
        approval("other", "accountAccess", otherScope),
      ],
    });

    harness.dappConnections.openConnection(dappScope);
    await harness.authorization.permissions.revoke(dappScope);

    expect(harness.commits).toEqual([[{ persistenceType: "permission", operation: "remove", key: dappScope }]]);
    expect(harness.dappConnections.getNetworkSelection(dappScope)).toEqual(selection(dappScope, "eip155:10"));
    expect(harness.dappConnections.getConnectionState(dappScope)).toEqual({ chainRef: "eip155:10", accounts: [] });
    expect(harness.cancelledApprovalIds).toEqual([["access", "sign", "send"]]);
    expect(harness.pendingApprovals().map(({ approvalId }) => approvalId)).toEqual(["switch", "other"]);
    expect(harness.permissionEvents).toEqual([{ type: "permissionsChanged", scopes: [dappScope] }]);
  });

  it("disconnects an origin without closing its active connection", async () => {
    const dappScope = scope("https://dapp.example");
    const otherScope = scope("https://other.example");
    const grant = permission(dappScope, [EIP155_ACCOUNT_A]);
    const otherGrant = permission(otherScope, [EIP155_ACCOUNT_B]);
    const harness = createHarness({
      permissions: [grant, otherGrant],
      networkSelections: [selection(dappScope, "eip155:10"), selection(otherScope, "eip155:1")],
      approvals: [
        approval("access", "accountAccess", dappScope),
        approval("switch", "switchNetwork", dappScope),
        approval("other", "accountAccess", otherScope),
      ],
    });

    harness.dappConnections.openConnection(dappScope);
    await harness.authorization.permissions.disconnectOrigin({ origin: dappScope.origin });

    expect(harness.commits).toHaveLength(1);
    expect(harness.commits[0]).toHaveLength(2);
    expect(harness.permissions.get(dappScope)).toBeNull();
    expect(harness.permissions.get(otherScope)).toEqual(otherGrant);
    expect(harness.dappConnections.getNetworkSelection(dappScope)).toBeNull();
    expect(harness.dappConnections.getNetworkSelection(otherScope)).toEqual(selection(otherScope, "eip155:1"));
    expect(harness.dappConnections.isConnectionOpen(dappScope)).toBe(true);
    expect(harness.dappConnections.getConnectionState(dappScope)).toEqual({ chainRef: "eip155:1", accounts: [] });
    expect(harness.cancelledApprovalIds).toEqual([["access", "switch"]]);
    expect(harness.pendingApprovals().map(({ approvalId }) => approvalId)).toEqual(["other"]);
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
        approval("access", "accountAccess", dappScope),
        approval("switch", "switchNetwork", dappScope),
        approval("other", "accountAccess", otherScope),
      ],
    });

    harness.dappConnections.openConnection(dappScope);
    harness.authorization.closeConnection(dappScope);
    harness.authorization.closeConnection(dappScope);

    expect(harness.commits).toEqual([]);
    expect(harness.permissions.get(dappScope)).toEqual(grant);
    expect(harness.dappConnections.getNetworkSelection(dappScope)).toEqual(dappSelection);
    expect(harness.dappConnections.isConnectionOpen(dappScope)).toBe(false);
    expect(harness.cancelledApprovalIds).toEqual([["access", "switch"]]);
    expect(harness.pendingApprovals().map(({ approvalId }) => approvalId)).toEqual(["other"]);
  });
});
