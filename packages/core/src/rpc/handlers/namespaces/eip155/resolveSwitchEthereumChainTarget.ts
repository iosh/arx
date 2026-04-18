import { ArxReasons, arxError } from "@arx/errors";
import { chainErrors } from "../../../../chains/errors.js";
import type { ChainRef } from "../../../../chains/ids.js";
import { type ChainMetadata, cloneChainMetadata } from "../../../../chains/metadata.js";

export type ResolveSwitchEthereumChainTargetParams = {
  chainId: string;
};

type SwitchEthereumChainTargetDeps = {
  supportedChains: {
    getChain(chainRef: ChainRef): { metadata: ChainMetadata } | null;
  };
  network: {
    getState(): { availableChainRefs: ChainRef[] };
  };
};

type ResolveSwitchEthereumChainTargetDeps = ResolveSwitchEthereumChainTargetParams & {
  supportedChains: SwitchEthereumChainTargetDeps["supportedChains"];
  network: SwitchEthereumChainTargetDeps["network"];
};

const listAvailableChainMetadata = ({
  supportedChains,
  network,
}: Pick<ResolveSwitchEthereumChainTargetDeps, "supportedChains" | "network">): ChainMetadata[] => {
  return network.getState().availableChainRefs.map((chainRef) => {
    const entry = supportedChains.getChain(chainRef);
    if (!entry) {
      throw chainErrors.notFound({ chainRef });
    }
    return cloneChainMetadata(entry.metadata);
  });
};

export const resolveSwitchEthereumChainTarget = ({
  supportedChains,
  network,
  chainId,
}: ResolveSwitchEthereumChainTargetDeps): ChainMetadata => {
  const availableChains = listAvailableChainMetadata({ supportedChains, network });
  const target = availableChains.find((item) => {
    const candidateChainId = typeof item.chainId === "string" ? item.chainId.toLowerCase() : null;
    if (candidateChainId && candidateChainId === chainId) {
      return true;
    }

    return false;
  });

  if (!target) {
    throw chainErrors.notFound({
      chainId,
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
