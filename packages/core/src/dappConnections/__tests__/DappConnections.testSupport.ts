import type { Accounts } from "../../accounts/Accounts.js";
import type { AccountId } from "../../accounts/accountId.js";
import type { Namespace } from "../../namespaces/types.js";
import type { ChainRef, Network, NetworksReader } from "../../networks/index.js";
import type { PermissionsReader } from "../../permissions/Permissions.js";
import type { PermissionRecord } from "../../permissions/persistence.js";
import { createCoreMutationQueue } from "../../persistence/mutationQueue.js";
import type { PersistenceChange } from "../../persistence/persistenceTypes.js";
import type { WalletStatus } from "../../wallet/Wallet.js";
import { type DappConnectionStateChanged, DappConnections } from "../DappConnections.js";
import type { DappConnectionScope, DappNetworkSelectionRecord } from "../persistence.js";
import { dappConnectionScopeKey } from "../scope.js";

const installedNetworks: readonly Network[] = [
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
  {
    chainRef: "solana:mainnet",
    namespace: "solana",
    source: "builtin",
    name: "Solana",
    nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 },
  },
];

const networksByChainRef = new Map(installedNetworks.map((network) => [network.chainRef, network]));

export const EIP155_ACCOUNT_A = "eip155:0000000000000000000000000000000000000001" as AccountId;
export const EIP155_ACCOUNT_B = "eip155:0000000000000000000000000000000000000002" as AccountId;
export const SOLANA_ACCOUNT = "solana:account-1" as AccountId;

export const selection = (origin: string, namespace: Namespace, chainRef: ChainRef): DappNetworkSelectionRecord => ({
  origin,
  namespace,
  chainRef,
});

export const createDappConnections = (
  input: Readonly<{
    networkSelections?: readonly DappNetworkSelectionRecord[];
    permissions?: readonly PermissionRecord[];
    walletStatus?: WalletStatus;
    onConnectionStateChanged?(change: DappConnectionStateChanged, connections: DappConnections): void;
  }> = {},
) => {
  const commits: PersistenceChange[][] = [];
  const events: DappConnectionStateChanged[] = [];
  const permissionRecords = new Map(
    (input.permissions ?? []).map((permission) => [dappConnectionScopeKey(permission), permission]),
  );
  let walletStatus = input.walletStatus ?? "unlocked";
  let selectedChainRefByNamespace: Record<Namespace, ChainRef> = {
    eip155: "eip155:1",
    solana: "solana:mainnet",
  };
  let commitFailure: Error | null = null;
  let dappConnections: DappConnections;

  const accounts = {
    getAddress: ({ accountId, chainRef }) => ({
      accountId,
      chainRef,
      canonicalAddress: `${chainRef}/${accountId}`,
      displayAddress: `${chainRef}/${accountId}`,
    }),
  } satisfies Pick<Accounts, "getAddress">;
  const permissions = {
    get: (scope) => permissionRecords.get(dappConnectionScopeKey(scope)) ?? null,
    list: () => [...permissionRecords.values()],
    listByOrigin: (origin) => [...permissionRecords.values()].filter((permission) => permission.origin === origin),
  } satisfies PermissionsReader;

  dappConnections = new DappConnections({
    bootstrap: { networkSelections: input.networkSelections ?? [] },
    accounts,
    networks: {
      get: (chainRef) => networksByChainRef.get(chainRef) ?? null,
      getSelection: () => {
        const selectedChainRef = selectedChainRefByNamespace.eip155;
        if (!selectedChainRef) throw new Error("Missing eip155 test selection");

        return {
          selectedNamespace: "eip155",
          selectedChainRef,
          selectedChainRefByNamespace,
        };
      },
    } satisfies Pick<NetworksReader, "get" | "getSelection">,
    permissions,
    wallet: { getStatus: () => walletStatus },
    mutations: createCoreMutationQueue({
      commit: async (changes) => {
        if (commitFailure) throw commitFailure;
        commits.push([...changes]);
      },
    }),
    publishConnectionStateChanged: (change) => {
      events.push(change);
      input.onConnectionStateChanged?.(change, dappConnections);
    },
  });

  return {
    dappConnections,
    commits,
    events,
    setCommitFailure: (failure: Error | null) => {
      commitFailure = failure;
    },
    setPermission: (permission: PermissionRecord) => {
      permissionRecords.set(dappConnectionScopeKey(permission), permission);
    },
    removePermission: (scope: DappConnectionScope) => {
      permissionRecords.delete(dappConnectionScopeKey(scope));
    },
    setWalletSelection: (namespace: Namespace, chainRef: ChainRef) => {
      selectedChainRefByNamespace = { ...selectedChainRefByNamespace, [namespace]: chainRef };
    },
    setWalletStatus: (status: WalletStatus) => {
      walletStatus = status;
    },
  };
};
