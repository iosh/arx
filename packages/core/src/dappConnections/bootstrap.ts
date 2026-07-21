import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { DappNetworkSelectionRecord } from "./persistence.js";

export type DappConnectionsBootstrap = Readonly<{
  networkSelections: readonly DappNetworkSelectionRecord[];
}>;

export const loadDappConnectionsBootstrap = async (
  readers: Pick<CorePersistenceReaders, "dappNetworkSelections">,
): Promise<DappConnectionsBootstrap> => ({
  networkSelections: await readers.dappNetworkSelections.listAll(),
});
