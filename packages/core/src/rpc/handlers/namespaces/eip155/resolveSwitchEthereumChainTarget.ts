import { eip155ChainRefFromChainIdHex } from "../../../../chains/eip155/format.js";
import { ChainNotCompatibleError, ChainNotFoundError } from "../../../../chains/errors.js";
import type { ChainRef } from "../../../../chains/ids.js";
import { type ChainDefinition, cloneChainDefinition } from "../../../../chains/metadata.js";

export type ResolveSwitchEthereumChainTargetParams = {
  chainId: string;
};

type SwitchEthereumChainTargetDeps = {
  supportedChains: {
    getChain(chainRef: ChainRef): { definition: ChainDefinition; namespace: string } | null;
  };
  chainRpc: {
    hasEndpoints(chainRef: ChainRef): boolean;
  };
};

type ResolveSwitchEthereumChainTargetDeps = ResolveSwitchEthereumChainTargetParams & {
  supportedChains: SwitchEthereumChainTargetDeps["supportedChains"];
  chainRpc: SwitchEthereumChainTargetDeps["chainRpc"];
};

export const resolveSwitchEthereumChainTarget = ({
  supportedChains,
  chainRpc,
  chainId,
}: ResolveSwitchEthereumChainTargetDeps): ChainDefinition => {
  const targetChainRef = eip155ChainRefFromChainIdHex(chainId);

  if (!chainRpc.hasEndpoints(targetChainRef)) {
    throw new ChainNotFoundError();
  }

  const entry = supportedChains.getChain(targetChainRef);
  if (!entry) {
    throw new ChainNotFoundError();
  }

  if (entry.namespace !== "eip155") {
    throw new ChainNotCompatibleError({
      message: "Requested chain is not compatible with wallet_switchEthereumChain",
    });
  }

  return cloneChainDefinition(entry.definition);
};
