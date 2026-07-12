import { type ChainDefinition, cloneChainDefinition } from "../../../../chains/definition.js";
import { ChainNotCompatibleError, ChainNotFoundError } from "../../../../chains/errors.js";
import type { ChainRef } from "../../../../chains/ids.js";
import { chainRefFromChainId } from "../../../../namespaces/eip155/chainId.js";
import * as Hex from "../../../../utils/hex.js";

export type ResolveSwitchEthereumChainTargetParams = {
  chainId: string;
};

type SwitchEthereumChainTargetDeps = {
  chainDefinitions: {
    getChain(chainRef: ChainRef): { definition: ChainDefinition; namespace: string } | null;
  };
  chainRpc: {
    hasEndpoints(chainRef: ChainRef): boolean;
  };
};

type ResolveSwitchEthereumChainTargetDeps = ResolveSwitchEthereumChainTargetParams & {
  chainDefinitions: SwitchEthereumChainTargetDeps["chainDefinitions"];
  chainRpc: SwitchEthereumChainTargetDeps["chainRpc"];
};

export const resolveSwitchEthereumChainTarget = ({
  chainDefinitions,
  chainRpc,
  chainId,
}: ResolveSwitchEthereumChainTargetDeps): ChainDefinition => {
  const targetChainRef = chainRefFromChainId(Hex.toBigInt(chainId));

  if (!chainRpc.hasEndpoints(targetChainRef)) {
    throw new ChainNotFoundError();
  }

  const entry = chainDefinitions.getChain(targetChainRef);
  if (!entry) {
    throw new ChainNotFoundError();
  }

  if (entry.namespace !== "eip155") {
    throw new ChainNotCompatibleError("Requested chain is not compatible with wallet_switchEthereumChain");
  }

  return cloneChainDefinition(entry.definition);
};
