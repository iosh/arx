import { describe, expect, it } from "vitest";
import { type DappConnectionStateChanged, DappConnections } from "../dappConnections/DappConnections.js";
import type { DappNetworkSelectionRecord } from "../dappConnections/persistence.js";
import { ACCOUNT_ID, ADDRESS, createAccounts } from "../namespaces/eip155/__tests__/fixtures.js";
import { createEip155NetworksAdapter } from "../namespaces/eip155/networks.js";
import { Permissions } from "../permissions/Permissions.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import type { PendingTransactionRecord } from "../transactions/persistence.js";
import { NetworkHasPendingTransactionsError } from "./errors.js";
import { Networks } from "./Networks.js";
import type { CustomNetworkRecord } from "./persistence.js";
import { createCustomNetworkRemoval } from "./removeCustomNetwork.js";
import type { NetworksChanged } from "./types.js";

const CUSTOM_CHAIN_REF = "eip155:8453";
const ETHEREUM_CHAIN_REF = "eip155:1";
const selectedScope = { origin: "https://selected.example", namespace: "eip155" } as const;
const closedScope = { origin: "https://closed.example", namespace: "eip155" } as const;
const otherScope = { origin: "https://other.example", namespace: "eip155" } as const;

const customNetwork: CustomNetworkRecord = {
  definition: {
    chainRef: CUSTOM_CHAIN_REF,
    name: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  defaultRpcEndpoints: ["https://base.example"],
};

const dappSelection: DappNetworkSelectionRecord = { ...selectedScope, chainRef: CUSTOM_CHAIN_REF };
const closedSelection: DappNetworkSelectionRecord = { ...closedScope, chainRef: CUSTOM_CHAIN_REF };
const otherSelection: DappNetworkSelectionRecord = { ...otherScope, chainRef: "eip155:10" };

const pendingTransaction = (chainRef = CUSTOM_CHAIN_REF): PendingTransactionRecord => ({
  transactionId: "pending-transaction",
  namespace: "eip155",
  chainRef,
  accountId: ACCOUNT_ID,
  initiator: { type: "wallet" },
  transaction: {
    from: ADDRESS,
    to: null,
    value: "0x0",
    data: "0x",
    gas: "0x5208",
    nonce: "0x1",
    type: "legacy",
    gasPrice: "0x1",
  },
  state: { status: "pending" },
  recovery: { rawTransaction: "0xdeadbeef" },
  createdAt: 1,
  updatedAt: 1,
});

const createFixture = (
  input: Readonly<{
    pendingTransactions?: readonly PendingTransactionRecord[];
    commitFailure?: Error;
  }> = {},
) => {
  const commits: PersistenceChange[][] = [];
  const changes: NetworksChanged[] = [];
  const connectionChanges: DappConnectionStateChanged[] = [];
  const mutations = createCoreMutationQueue({
    commit: async (persistenceChanges) => {
      if (input.commitFailure) throw input.commitFailure;
      commits.push([...persistenceChanges]);
    },
  });
  const networks = new Networks({
    adapters: [
      createEip155NetworksAdapter({
        transport: {
          request: async () => {
            throw new Error("Unexpected RPC request during network removal.");
          },
        },
      }),
    ],
    bootstrap: {
      customNetworks: [customNetwork],
      networkRpcOverrides: [{ chainRef: CUSTOM_CHAIN_REF, endpoints: ["https://base-override.example"] }],
    },
    mutations,
    publishChanged: (change) => changes.push(change),
  });
  const accounts = createAccounts();
  const permissions = new Permissions({
    bootstrap: {
      records: [
        { ...selectedScope, accountIds: [ACCOUNT_ID] },
        { ...otherScope, accountIds: ["eip155:7e5f4552091a69125d5dfcb7b8c2659029395bdf"] },
      ],
    },
    accounts,
  });
  const dappConnections = new DappConnections({
    bootstrap: { networkSelections: [dappSelection, closedSelection, otherSelection] },
    accounts,
    networks,
    permissions,
    wallet: { getStatus: () => "unlocked" },
    mutations,
    publishStateChanged: (change) => connectionChanges.push(change),
  });
  const removal = createCustomNetworkRemoval({
    mutations,
    networks,
    transactions: { listPending: async () => input.pendingTransactions ?? [] },
    prepareDappNetworkRemoval: (chainRef) =>
      dappConnections.prepareRemoveNetworkReferences(chainRef, ETHEREUM_CHAIN_REF),
  });

  return { removal, networks, dappConnections, commits, changes, connectionChanges };
};

describe("custom network removal", () => {
  it("clears open and closed site references while preserving accounts and other sites' chains", async () => {
    const fixture = createFixture({ pendingTransactions: [pendingTransaction("eip155:1")] });
    fixture.dappConnections.openConnection(otherScope, ETHEREUM_CHAIN_REF);
    fixture.dappConnections.openConnection(selectedScope, ETHEREUM_CHAIN_REF);

    await fixture.removal.removeCustom(CUSTOM_CHAIN_REF);

    expect(fixture.commits).toHaveLength(1);
    expect(fixture.commits[0]).toHaveLength(4);
    expect(fixture.commits[0]).toEqual(
      expect.arrayContaining([
        { persistenceType: "customNetwork", operation: "remove", key: CUSTOM_CHAIN_REF },
        { persistenceType: "networkRpcOverride", operation: "remove", key: CUSTOM_CHAIN_REF },
        { persistenceType: "dappNetworkSelection", operation: "remove", key: expect.objectContaining(selectedScope) },
        { persistenceType: "dappNetworkSelection", operation: "remove", key: expect.objectContaining(closedScope) },
      ]),
    );
    expect(fixture.networks.get(CUSTOM_CHAIN_REF)).toBeNull();
    expect(fixture.dappConnections.getNetworkSelection(selectedScope)).toBeNull();
    expect(fixture.dappConnections.getNetworkSelection(closedScope)).toBeNull();
    expect(fixture.dappConnections.getConnectionState(selectedScope, ETHEREUM_CHAIN_REF)).toEqual({
      chainRef: ETHEREUM_CHAIN_REF,
      accounts: [ADDRESS],
    });
    expect(fixture.dappConnections.getNetworkSelection(otherScope)).toEqual(otherSelection);
    expect(fixture.dappConnections.getConnectionState(otherScope, ETHEREUM_CHAIN_REF)).toEqual({
      chainRef: "eip155:10",
      accounts: ["0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"],
    });
    expect(fixture.dappConnections.openConnection(closedScope, ETHEREUM_CHAIN_REF)).toEqual({
      chainRef: ETHEREUM_CHAIN_REF,
      accounts: [],
    });
    expect(fixture.changes).toEqual([{ type: "networksChanged", chainRefs: [CUSTOM_CHAIN_REF] }]);
    expect(fixture.connectionChanges).toEqual([
      {
        scope: selectedScope,
        state: { chainRef: ETHEREUM_CHAIN_REF, accounts: [ADDRESS] },
        changedFields: { chainRef: true, accounts: false },
      },
    ]);
  });

  it("keeps the network and site state when a pending transaction blocks removal", async () => {
    const fixture = createFixture({ pendingTransactions: [pendingTransaction()] });
    fixture.dappConnections.openConnection(selectedScope, ETHEREUM_CHAIN_REF);

    await expect(fixture.removal.removeCustom(CUSTOM_CHAIN_REF)).rejects.toBeInstanceOf(
      NetworkHasPendingTransactionsError,
    );

    expect(fixture.commits).toEqual([]);
    expect(fixture.networks.get(CUSTOM_CHAIN_REF)).toMatchObject({ source: "custom" });
    expect(fixture.dappConnections.getNetworkSelection(selectedScope)).toEqual(dappSelection);
    expect(fixture.dappConnections.getConnectionState(selectedScope, ETHEREUM_CHAIN_REF)).toEqual({
      chainRef: CUSTOM_CHAIN_REF,
      accounts: [ADDRESS],
    });
    expect(fixture.changes).toEqual([]);
    expect(fixture.connectionChanges).toEqual([]);
  });

  it("does not activate removal when persistence fails", async () => {
    const failure = new Error("commit failed");
    const fixture = createFixture({ commitFailure: failure });
    fixture.dappConnections.openConnection(selectedScope, ETHEREUM_CHAIN_REF);

    await expect(fixture.removal.removeCustom(CUSTOM_CHAIN_REF)).rejects.toBe(failure);

    expect(fixture.commits).toEqual([]);
    expect(fixture.networks.get(CUSTOM_CHAIN_REF)).toMatchObject({ source: "custom" });
    expect(fixture.dappConnections.getNetworkSelection(selectedScope)).toEqual(dappSelection);
    expect(fixture.dappConnections.getConnectionState(selectedScope, ETHEREUM_CHAIN_REF)).toEqual({
      chainRef: CUSTOM_CHAIN_REF,
      accounts: [ADDRESS],
    });
    expect(fixture.changes).toEqual([]);
    expect(fixture.connectionChanges).toEqual([]);
  });
});
