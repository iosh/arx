import { ArxReasons, arxError } from "@arx/errors";
import { chainErrors } from "../../../../chains/errors.js";
import type { ChainRef } from "../../../../chains/ids.js";
import { type ChainMetadata, cloneChainMetadata } from "../../../../chains/metadata.js";

export type ResolveSwitchEthereumChainTargetParams = {
  chainId?: string;
  chainRef?: string;
};

type SwitchEthereumChainTargetDeps = {
  chainDefinitions: {
    getChain(chainRef: ChainRef): { metadata: ChainMetadata } | null;
  };
  network: {
    getState(): { availableChainRefs: ChainRef[] };
  };
};

type ResolveSwitchEthereumChainTargetDeps = ResolveSwitchEthereumChainTargetParams & {
  chainDefinitions: SwitchEthereumChainTargetDeps["chainDefinitions"];
  network: SwitchEthereumChainTargetDeps["network"];
};

const listAvailableChainMetadata = ({
  chainDefinitions,
  network,
}: Pick<ResolveSwitchEthereumChainTargetDeps, "chainDefinitions" | "network">): ChainMetadata[] => {
  return network.getState().availableChainRefs.map((chainRef) => {
    const entry = chainDefinitions.getChain(chainRef);
    if (!entry) {
      throw chainErrors.notFound({ chainRef });
    }
    return cloneChainMetadata(entry.metadata);
  });
};

export const resolveSwitchEthereumChainTarget = ({
  chainDefinitions,
  network,
  chainId,
  chainRef,
}: ResolveSwitchEthereumChainTargetDeps): ChainMetadata => {
  const availableChains = listAvailableChainMetadata({ chainDefinitions, network });
  const target = availableChains.find((item) => {
    if (chainRef && item.chainRef === (chainRef as ChainRef)) {
      return true;
    }

    if (chainId) {
      const candidateChainId = typeof item.chainId === "string" ? item.chainId.toLowerCase() : null;
      if (candidateChainId && candidateChainId === chainId) {
        return true;
      }
    }

    return false;
  });

  if (!target) {
    throw chainErrors.notFound({
      ...(chainId ? { chainId } : {}),
      ...(chainRef ? { chainRef } : {}),
    });
  }

  if (target.namespace !== "eip155") {
    throw arxError({
      reason: ArxReasons.ChainNotCompatible,
      message: "Requested chain is not compatible with wallet_switchEthereumChain",
      data: { chainRef: target.chainRef },
    });
  }

  return target;
};
