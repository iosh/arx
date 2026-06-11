import { eip155ChainRefFromChainIdHex } from "../../../../chains/eip155/format.js";
import { ChainNotCompatibleError, ChainNotFoundError } from "../../../../chains/errors.js";
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

export const resolveSwitchEthereumChainTarget = ({
  supportedChains,
  network,
  chainId,
}: ResolveSwitchEthereumChainTargetDeps): ChainMetadata => {
  const targetChainRef = eip155ChainRefFromChainIdHex(chainId);
  const isAvailable = network.getState().availableChainRefs.some((chainRef) => chainRef === targetChainRef);

  if (!isAvailable) {
    throw new ChainNotFoundError();
  }

  const entry = supportedChains.getChain(targetChainRef);
  if (!entry) {
    throw new ChainNotFoundError();
  }

  const target = cloneChainMetadata(entry.metadata);
  if (target.namespace !== "eip155") {
    throw new ChainNotCompatibleError({
      message: "Requested chain is not compatible with wallet_switchEthereumChain",
    });
  }

  return target;
};
