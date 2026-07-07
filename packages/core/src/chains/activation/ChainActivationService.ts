import { parseChainRef } from "../caip.js";
import { ChainNotAvailableError, ChainNotCompatibleError, ChainNotSupportedError } from "../errors.js";
import type { ChainRef } from "../ids.js";
import type { ChainRpcReader } from "../rpc/types.js";
import { RpcInvalidParamsError } from "../../rpc/errors.js";
import type { ProviderChainSelectionService } from "../selection/provider/types.js";
import type { WalletChainSelectionService } from "../selection/wallet/types.js";
import type { ActivateNamespaceChainParams, ChainActivationService, SelectProviderChainParams } from "./types.js";

export type CreateChainActivationServiceOptions = {
  chainRpc: Pick<ChainRpcReader, "hasEndpoints">;
  walletChainSelection: Pick<WalletChainSelectionService, "getSelectedChainRef" | "selectChain" | "selectNamespace">;
  providerChainSelection: Pick<ProviderChainSelectionService, "setSelectedChainRef">;
  logger?: (message: string, error?: unknown) => void;
};

export const createChainActivationService = ({
  chainRpc,
  walletChainSelection,
  providerChainSelection,
}: CreateChainActivationServiceOptions): ChainActivationService => {
  const isAvailableChainRef = (chainRef: ChainRef): boolean => {
    return chainRpc.hasEndpoints(chainRef);
  };

  const assertAvailableChainRef = (chainRef: ChainRef): void => {
    if (!isAvailableChainRef(chainRef)) {
      throw new ChainNotAvailableError();
    }
  };

  const resolveAvailableActiveChainRefForNamespace = (namespace: string): ChainRef => {
    const namespaceKey = namespace.trim();
    if (namespaceKey.length === 0) {
      throw new RpcInvalidParamsError({
        message: "Invalid namespace identifier",
        details: { namespace },
      });
    }

    const activeChainRef = walletChainSelection.getSelectedChainRef(namespaceKey);
    if (!activeChainRef) {
      throw new ChainNotSupportedError({
        message: `No active chain configured for namespace "${namespaceKey}"`,
      });
    }

    const parsed = parseChainRef(activeChainRef);
    if (parsed.namespace !== namespaceKey) {
      throw new ChainNotCompatibleError({
        message: `Active chain "${activeChainRef}" does not belong to namespace "${namespaceKey}"`,
      });
    }

    assertAvailableChainRef(activeChainRef);
    return activeChainRef;
  };

  const persistNamespaceChainSelection = async (chainRef: ChainRef) => {
    return await walletChainSelection.selectChain(chainRef);
  };

  const persistWalletChainSelection = async (chainRef: ChainRef) => {
    return await walletChainSelection.selectChain(chainRef);
  };

  const selectWalletChain = async (chainRef: ChainRef): Promise<void> => {
    assertAvailableChainRef(chainRef);
    await persistWalletChainSelection(chainRef);
  };

  const selectWalletNamespace = async (namespace: string): Promise<void> => {
    const namespaceKey = namespace.trim();
    resolveAvailableActiveChainRefForNamespace(namespaceKey);
    await walletChainSelection.selectNamespace(namespaceKey);
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

  const selectProviderChain = async ({
    origin,
    namespace,
    chainRef,
    reason,
  }: SelectProviderChainParams): Promise<void> => {
    const parsed = parseChainRef(chainRef);
    if (parsed.namespace !== namespace) {
      throw new ChainNotCompatibleError({
        message: `Provider chain selection namespace mismatch for reason "${reason}"`,
      });
    }

    assertAvailableChainRef(chainRef);
    await providerChainSelection.setSelectedChainRef({ origin, namespace, chainRef });
  };

  return { selectWalletChain, selectWalletNamespace, activateNamespaceChain, selectProviderChain };
};
