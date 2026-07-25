import type { DappConnections } from "../dappConnections/DappConnections.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { TransactionsReader } from "../transactions/persistence.js";
import type { ChainRef } from "./chainRef.js";
import { NetworkHasPendingTransactionsError } from "./errors.js";
import type { Networks } from "./Networks.js";

export type CustomNetworkRemoval = Readonly<{
  removeCustom(chainRef: ChainRef): Promise<void>;
}>;

type CustomNetworkRemovalOptions = Readonly<{
  mutations: CoreMutationQueue;
  networks: Pick<Networks, "prepareRemoveCustom">;
  transactions: Pick<TransactionsReader, "listPending">;
  dappConnections: Pick<DappConnections, "prepareRemoveNetworkReferences">;
}>;

export const createCustomNetworkRemoval = (options: CustomNetworkRemovalOptions): CustomNetworkRemoval => ({
  async removeCustom(chainRef) {
    await options.mutations.run(async (commit) => {
      const networkRemoval = options.networks.prepareRemoveCustom(chainRef);
      const pending = await options.transactions.listPending();
      if (pending.some((transaction) => transaction.chainRef === chainRef)) {
        throw new NetworkHasPendingTransactionsError(chainRef);
      }

      const dappConnectionsUpdate = options.dappConnections.prepareRemoveNetworkReferences(chainRef);

      await commit([...networkRemoval.persistenceChanges, ...dappConnectionsUpdate.persistenceChanges]);

      networkRemoval.activate();
      dappConnectionsUpdate.activate();
      networkRemoval.publish();
    });
  },
});
