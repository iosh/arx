import { ACCOUNT_ID, createAccounts, createNetworks } from "../../namespaces/eip155/__tests__/fixtures.js";
import type { Namespace } from "../../namespaces/types.js";
import type { ChainRef } from "../../networks/index.js";
import { Permissions } from "../../permissions/Permissions.js";
import type { PermissionRecord } from "../../permissions/persistence.js";
import { createCoreMutationQueue } from "../../persistence/mutationQueue.js";
import type { PersistenceChange } from "../../persistence/persistenceTypes.js";
import type { WalletStatus } from "../../wallet/Wallet.js";
import { type DappConnectionStateChanged, DappConnections } from "../DappConnections.js";
import type { DappNetworkSelectionRecord } from "../persistence.js";

export const EIP155_ACCOUNT_A = ACCOUNT_ID;
export const EIP155_ACCOUNT_B = "eip155:7e5f4552091a69125d5dfcb7b8c2659029395bdf";

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
  }> = {},
) => {
  const commits: PersistenceChange[][] = [];
  const stateChanges: DappConnectionStateChanged[] = [];
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
    publishStateChanged: (change) => stateChanges.push(change),
  });

  return {
    dappConnections,
    commits,
    stateChanges,
    setCommitFailure: (failure: Error | null) => {
      commitFailure = failure;
    },
    setWalletStatus: (status: WalletStatus) => {
      walletStatus = status;
    },
  };
};
