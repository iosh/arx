import { describe, expect, it } from "vitest";
import type { Accounts } from "../accounts/Accounts.js";
import { DappConnections } from "../dappConnections/DappConnections.js";
import type { DappNetworkSelectionRecord } from "../dappConnections/persistence.js";
import type { PermissionsReader } from "../permissions/Permissions.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import type { PendingTransactionRecord } from "../transactions/persistence.js";
import type { Wallet } from "../wallet/Wallet.js";
import { NetworkHasPendingTransactionsError } from "./errors.js";
import { Networks } from "./Networks.js";
import type { NetworksNamespaceAdapters } from "./namespaceAdapter.js";
import type { CustomNetworkRecord, NetworkRpcOverrideRecord, NetworkSelectionRecord } from "./persistence.js";
import { createCustomNetworkRemoval } from "./removeCustomNetwork.js";
import type { NetworkSelectionChanged, NetworksChanged } from "./types.js";

const CUSTOM_CHAIN_REF = "eip155:10";
const DEFAULT_CHAIN_REF = "eip155:1";
const accountId = "eip155:0000000000000000000000000000000000000001";
const persistedScope = { origin: "https://selected.example", namespace: "eip155" } as const;
const transientScope = { origin: "https://transient.example", namespace: "eip155" } as const;

const customNetwork: CustomNetworkRecord = {
  definition: {
    chainRef: CUSTOM_CHAIN_REF,
    name: "Optimism",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  defaultRpcEndpoints: ["https://optimism.example"],
};

const selection: NetworkSelectionRecord = {
  selectedNamespace: "eip155",
  selectedChainRefByNamespace: { eip155: CUSTOM_CHAIN_REF },
};

const dappSelection: DappNetworkSelectionRecord = {
  ...persistedScope,
  chainRef: CUSTOM_CHAIN_REF,
};

const pendingTransaction = (): PendingTransactionRecord => ({
  transactionId: "pending-transaction",
  namespace: "eip155",
  chainRef: CUSTOM_CHAIN_REF,
  accountId,
  initiator: { type: "wallet" },
  transaction: {
    from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    to: null,
    value: "0x0",
    data: "0x",
    gas: "0x5208",
    nonce: "0x1",
    fee: { type: "legacy", gasPrice: "0x1" },
  },
  state: { status: "pending" },
  recovery: { rawTransaction: "0xdeadbeef" },
  createdAt: 1,
  updatedAt: 1,
});

const createAdapters = (): NetworksNamespaceAdapters => [
  {
    namespace: "eip155",
    builtinNetworks: [
      {
        definition: {
          chainRef: DEFAULT_CHAIN_REF,
          name: "Ethereum",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        },
        defaultRpcEndpoints: ["https://ethereum.example"],
      },
    ],
    defaultChainRef: DEFAULT_CHAIN_REF,
    queryChainRef: async () => DEFAULT_CHAIN_REF,
  },
];

type FixtureOptions = Readonly<{
  pendingTransactions?: readonly PendingTransactionRecord[];
  commitFailure?: Error;
}>;

const createFixture = (input: FixtureOptions = {}) => {
  const commits: PersistenceChange[][] = [];
  const changes: Array<NetworksChanged | NetworkSelectionChanged> = [];
  const mutations = createCoreMutationQueue({
    commit: async (persistenceChanges) => {
      if (input.commitFailure) throw input.commitFailure;
      commits.push([...persistenceChanges]);
    },
  });
  const networks = new Networks({
    adapters: createAdapters(),
    defaultNamespace: "eip155",
    bootstrap: {
      customNetworks: [customNetwork],
      networkRpcOverrides: [
        {
          chainRef: CUSTOM_CHAIN_REF,
          endpoints: ["https://optimism-override.example"],
        } satisfies NetworkRpcOverrideRecord,
      ],
      selection,
    },
    mutations,
    publishChanged: (change) => changes.push(change),
  });
  const permissions = {
    get: () => null,
    list: () => [],
    listByOrigin: () => [],
  } satisfies PermissionsReader;
  const dappConnections = new DappConnections({
    bootstrap: { networkSelections: [dappSelection] },
    accounts: {
      getAddress: ({ accountId: currentAccountId, chainRef }) => ({
        accountId: currentAccountId,
        chainRef,
        canonicalAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        displayAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    } satisfies Pick<Accounts, "getAddress">,
    networks,
    permissions,
    wallet: { getStatus: () => "unlocked" } satisfies Pick<Wallet, "getStatus">,
    mutations,
  });
  const removal = createCustomNetworkRemoval({
    mutations,
    networks,
    transactions: {
      listPending: async () => input.pendingTransactions ?? [],
    },
    dappConnections,
  });

  return {
    removal,
    networks,
    dappConnections,
    commits,
    changes,
  };
};

describe("custom network removal", () => {
  it("removes the network and every live selection after one successful commit", async () => {
    const fixture = createFixture();
    fixture.dappConnections.openConnection(persistedScope);
    fixture.dappConnections.openConnection(transientScope);

    await fixture.removal.removeCustom(CUSTOM_CHAIN_REF);

    expect(fixture.commits).toHaveLength(1);
    expect(fixture.commits[0]?.map((change) => `${change.persistenceType}.${change.operation}`)).toEqual([
      "customNetwork.remove",
      "networkRpcOverride.remove",
      "networkSelection.put",
      "dappNetworkSelection.remove",
    ]);
    expect(fixture.networks.get(CUSTOM_CHAIN_REF)).toBeNull();
    expect(fixture.networks.getSelection()).toEqual({
      selectedNamespace: "eip155",
      selectedChainRef: DEFAULT_CHAIN_REF,
      selectedChainRefByNamespace: { eip155: DEFAULT_CHAIN_REF },
    });
    expect(fixture.dappConnections.getNetworkSelection(persistedScope)).toBeNull();
    expect(fixture.dappConnections.getConnectionState(persistedScope)).toEqual({
      chainRef: DEFAULT_CHAIN_REF,
      accounts: [],
    });
    expect(fixture.dappConnections.getConnectionState(transientScope)).toEqual({
      chainRef: DEFAULT_CHAIN_REF,
      accounts: [],
    });
    expect(fixture.changes).toEqual([
      { type: "networksChanged", chainRefs: [CUSTOM_CHAIN_REF] },
      { type: "networkSelectionChanged", namespaces: ["eip155"] },
    ]);
  });

  it("does not change owner state when a pending transaction blocks removal", async () => {
    const fixture = createFixture({ pendingTransactions: [pendingTransaction()] });

    await expect(fixture.removal.removeCustom(CUSTOM_CHAIN_REF)).rejects.toBeInstanceOf(
      NetworkHasPendingTransactionsError,
    );

    expect(fixture.commits).toEqual([]);
    expect(fixture.networks.get(CUSTOM_CHAIN_REF)).toMatchObject({ source: "custom" });
    expect(fixture.networks.getSelection().selectedChainRef).toBe(CUSTOM_CHAIN_REF);
    expect(fixture.dappConnections.getNetworkSelection(persistedScope)).toEqual(dappSelection);
    expect(fixture.changes).toEqual([]);
  });

  it("does not activate removal when persistence fails", async () => {
    const failure = new Error("commit failed");
    const fixture = createFixture({ commitFailure: failure });
    fixture.dappConnections.openConnection(persistedScope);

    await expect(fixture.removal.removeCustom(CUSTOM_CHAIN_REF)).rejects.toBe(failure);

    expect(fixture.commits).toEqual([]);
    expect(fixture.networks.get(CUSTOM_CHAIN_REF)).toMatchObject({ source: "custom" });
    expect(fixture.networks.getSelection().selectedChainRef).toBe(CUSTOM_CHAIN_REF);
    expect(fixture.dappConnections.getNetworkSelection(persistedScope)).toEqual(dappSelection);
    expect(fixture.dappConnections.getConnectionState(persistedScope)).toEqual({
      chainRef: CUSTOM_CHAIN_REF,
      accounts: [],
    });
    expect(fixture.changes).toEqual([]);
  });
});
