import { ArxReasons, arxError } from "@arx/errors";
import { parseChainRef } from "../../../chains/caip.js";
import { chainErrors } from "../../../chains/errors.js";
import type { ChainRef } from "../../../chains/ids.js";
import type { NetworkController } from "../../../controllers/network/types.js";
import type { NetworkSelectionService } from "../../store/networkSelection/types.js";
import type { ActivateNamespaceChainParams, ChainActivationService } from "./types.js";

export type CreateChainActivationServiceOptions = {
  network: Pick<NetworkController, "getState">;
  networkSelection: Pick<NetworkSelectionService, "getSelectedChainRef" | "selectChain" | "selectNamespace">;
  logger?: (message: string, error?: unknown) => void;
};

export const createChainActivationService = ({
  network,
  networkSelection,
}: CreateChainActivationServiceOptions): ChainActivationService => {
  const isAvailableChainRef = (chainRef: ChainRef): boolean => {
    return network.getState().availableChainRefs.some((availableChainRef) => availableChainRef === chainRef);
  };

  const assertAvailableChainRef = (chainRef: ChainRef): void => {
    if (!isAvailableChainRef(chainRef)) {
      throw chainErrors.notAvailable({ chainRef });
    }
  };

  const resolveAvailableActiveChainRefForNamespace = (namespace: string): ChainRef => {
    const normalizedNamespace = namespace.trim();
    if (normalizedNamespace.length === 0) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "Invalid namespace identifier",
        data: { namespace },
      });
    }

    const activeChainRef = networkSelection.getSelectedChainRef(normalizedNamespace);
    if (!activeChainRef) {
      throw arxError({
        reason: ArxReasons.ChainNotSupported,
        message: `No active chain configured for namespace "${normalizedNamespace}"`,
        data: { namespace: normalizedNamespace },
      });
    }

    const parsed = parseChainRef(activeChainRef);
    if (parsed.namespace !== normalizedNamespace) {
      throw arxError({
        reason: ArxReasons.ChainNotCompatible,
        message: `Active chain "${activeChainRef}" does not belong to namespace "${normalizedNamespace}"`,
        data: { namespace: normalizedNamespace, chainRef: activeChainRef, actualNamespace: parsed.namespace },
      });
    }

    assertAvailableChainRef(activeChainRef);
    return activeChainRef;
  };

  const persistNamespaceChainSelection = async (chainRef: ChainRef) => {
    return await networkSelection.selectChain(chainRef);
  };

  const persistWalletChainSelection = async (chainRef: ChainRef) => {
    return await networkSelection.selectChain(chainRef);
  };

  const selectWalletChain = async (chainRef: ChainRef): Promise<void> => {
    assertAvailableChainRef(chainRef);
    await persistWalletChainSelection(chainRef);
  };

  const selectWalletNamespace = async (namespace: string): Promise<void> => {
    const normalizedNamespace = namespace.trim();
    resolveAvailableActiveChainRefForNamespace(normalizedNamespace);
    await networkSelection.selectNamespace(normalizedNamespace);
  };

  const activateNamespaceChain = async ({
    namespace,
    chainRef,
    reason,
  }: ActivateNamespaceChainParams): Promise<void> => {
    const parsed = parseChainRef(chainRef);
    if (parsed.namespace !== namespace) {
      throw arxError({
        reason: ArxReasons.ChainNotCompatible,
        message: `Chain activation namespace mismatch for reason "${reason}"`,
        data: { reason, expectedNamespace: namespace, actualNamespace: parsed.namespace, chainRef },
      });
    }

    assertAvailableChainRef(chainRef);
    await persistNamespaceChainSelection(chainRef);
  };

  return { selectWalletChain, selectWalletNamespace, activateNamespaceChain };
};
