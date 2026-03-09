import { parseChainRef } from "../../../chains/caip.js";
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
  network: Pick<NetworkController, "getState" | "switchChain">;
  preferences: Pick<NetworkPreferencesService, "setActiveChainRef" | "update">;
  logger?: (message: string, error?: unknown) => void;
};

export const createChainActivationService = ({
  network,
  preferences,
  logger = () => {},
}: CreateChainActivationServiceOptions): ChainActivationService => {
  const persistProviderChainSelection = async (chainRef: ChainRef) => {
    return await preferences.setActiveChainRef(chainRef);
  };

  const persistWalletChainSelection = async (chainRef: ChainRef) => {
    const [namespace] = chainRef.split(":");
    if (!namespace) {
      throw new Error(`Invalid chainRef: ${chainRef}`);
    }

    return await preferences.update({
      selectedChainRef: chainRef,
      activeChainByNamespacePatch: { [namespace]: chainRef },
    });
  };

  const selectWalletChain = async (chainRef: ChainRef): Promise<void> => {
    const previousActive = network.getState().activeChainRef;
    const switched = previousActive !== chainRef;

    if (switched) {
      await network.switchChain(chainRef);
    }

    try {
      await persistWalletChainSelection(chainRef);
    } catch (error) {
      if (switched) {
        try {
          await network.switchChain(previousActive);
        } catch (rollbackError) {
          logger("chainActivation: failed to rollback active chain after persistence failure", rollbackError);
        }
      }
      throw error;
    }
  };

  const shouldSyncSelectedChain = (policy: ChainSelectionSyncPolicy, namespace: string): boolean => {
    switch (policy) {
      case ChainSelectionSyncPolicies.Always:
        return true;
      case ChainSelectionSyncPolicies.Never:
        return false;
      default:
        return network.getState().activeChainRef.split(":")[0] === namespace;
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

  const activate = async (chainRef: ChainRef): Promise<void> => {
    await selectWalletChain(chainRef);
  };

  return { activate, selectWalletChain, activateProviderChain };
};
