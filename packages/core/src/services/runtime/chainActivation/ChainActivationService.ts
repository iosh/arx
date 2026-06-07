import { parseChainRef } from "../../../chains/caip.js";
import { ChainNotAvailableError, ChainNotCompatibleError, ChainNotSupportedError } from "../../../chains/errors.js";
import type { ChainRef } from "../../../chains/ids.js";
import type { RpcRoutingService } from "../../../chains/runtime/types.js";
import { RpcInvalidParamsError } from "../../../rpc/errors.js";
import type { NetworkSelectionService } from "../../store/networkSelection/types.js";
import type { ActivateNamespaceChainParams, ChainActivationService } from "./types.js";

export type CreateChainActivationServiceOptions = {
  network: Pick<RpcRoutingService, "getState">;
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
      throw new ChainNotAvailableError();
    }
  };

  const resolveAvailableActiveChainRefForNamespace = (namespace: string): ChainRef => {
    const normalizedNamespace = namespace.trim();
    if (normalizedNamespace.length === 0) {
      throw new RpcInvalidParamsError({
        message: "Invalid namespace identifier",
        details: { namespace },
      });
    }

    const activeChainRef = networkSelection.getSelectedChainRef(normalizedNamespace);
    if (!activeChainRef) {
      throw new ChainNotSupportedError({
        message: `No active chain configured for namespace "${normalizedNamespace}"`,
      });
    }

    const parsed = parseChainRef(activeChainRef);
    if (parsed.namespace !== normalizedNamespace) {
      throw new ChainNotCompatibleError({
        message: `Active chain "${activeChainRef}" does not belong to namespace "${normalizedNamespace}"`,
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
      throw new ChainNotCompatibleError({
        message: `Chain activation namespace mismatch for reason "${reason}"`,
      });
    }

    assertAvailableChainRef(chainRef);
    await persistNamespaceChainSelection(chainRef);
  };

  return { selectWalletChain, selectWalletNamespace, activateNamespaceChain };
};
