import { getChainRefNamespace, parseChainRef } from "../../../chains/caip.js";
import { chainErrors } from "../../../chains/errors.js";
import type { ChainRef } from "../../../chains/ids.js";
import type { NetworkController } from "../../../controllers/network/types.js";
import type { NetworkPreferencesService } from "../../store/networkPreferences/types.js";
import {
  type ActivateProviderChainParams,
  type ChainActivationService,
  ChainSelectionSyncPolicies,
  type ChainSelectionSyncPolicy,
} from "./types.js";

export type CreateChainActivationServiceOptions = {
  network: Pick<NetworkController, "getState">;
  preferences: Pick<NetworkPreferencesService, "getSelectedNamespace" | "setActiveChainRef" | "update">;
  logger?: (message: string, error?: unknown) => void;
};

export const createChainActivationService = ({
  network,
  preferences,
}: CreateChainActivationServiceOptions): ChainActivationService => {
  const persistProviderChainSelection = async (chainRef: ChainRef) => {
    return await preferences.setActiveChainRef(chainRef);
  };

  const persistWalletChainSelection = async (chainRef: ChainRef) => {
    const namespace = getChainRefNamespace(chainRef);

    return await preferences.update({
      selectedNamespace: namespace,
      activeChainByNamespacePatch: { [namespace]: chainRef },
    });
  };

  const selectWalletChain = async (chainRef: ChainRef): Promise<void> => {
    const isAvailable = network
      .getState()
      .availableChainRefs.some((availableChainRef) => availableChainRef === chainRef);
    if (!isAvailable) {
      throw chainErrors.notAvailable({ chainRef });
    }

    await persistWalletChainSelection(chainRef);
  };

  const shouldSyncSelectedChain = (policy: ChainSelectionSyncPolicy, namespace: string): boolean => {
    switch (policy) {
      case ChainSelectionSyncPolicies.Always:
        return true;
      case ChainSelectionSyncPolicies.Never:
        return false;
      default:
        return preferences.getSelectedNamespace() === namespace;
    }
  };

  const activateProviderChain = async ({
    namespace,
    chainRef,
    reason,
    syncSelectedChain = ChainSelectionSyncPolicies.IfSelectedNamespaceMatches,
  }: ActivateProviderChainParams): Promise<void> => {
    const parsed = parseChainRef(chainRef);
    if (parsed.namespace !== namespace) {
      throw new Error(
        `Chain activation namespace mismatch for reason "${reason}": expected "${namespace}", got "${parsed.namespace}"`,
      );
    }

    if (shouldSyncSelectedChain(syncSelectedChain, namespace)) {
      await selectWalletChain(chainRef);
      return;
    }

    await persistProviderChainSelection(chainRef);
  };

  return { selectWalletChain, activateProviderChain };
};
