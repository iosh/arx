import { getChainRefNamespace } from "../../chains/caip.js";
import type { ChainRef } from "../../chains/ids.js";
import { type ChainMetadata, cloneChainMetadata } from "../../chains/metadata.js";
import { RuntimeConfigError } from "./errors.js";

export type RuntimeWalletChainSelectionDefaults = {
  selectedNamespace: string;
  chainRefByNamespace: Record<string, ChainRef>;
};

export type RuntimeChainAdmission = {
  admittedChains: ChainMetadata[];
  selectionDefaults: RuntimeWalletChainSelectionDefaults;
};

const createChainRefDefaults = (
  admittedChains: readonly ChainMetadata[],
  selectedUiChainRef: ChainRef,
): Record<string, ChainRef> => {
  const next: Record<string, ChainRef> = {};

  for (const chain of admittedChains) {
    if (!(chain.namespace in next)) {
      next[chain.namespace] = chain.chainRef;
    }
  }

  next[getChainRefNamespace(selectedUiChainRef)] = selectedUiChainRef;
  return next;
};

export const buildRuntimeChainAdmission = (params: {
  admittedChains: readonly ChainMetadata[];
}): RuntimeChainAdmission => {
  const admittedChains = params.admittedChains.map((chain) => cloneChainMetadata(chain));
  const primaryChain = admittedChains[0];
  if (!primaryChain) {
    throw new RuntimeConfigError({ reason: "missing_admitted_chain" });
  }

  return {
    admittedChains,
    selectionDefaults: {
      selectedNamespace: primaryChain.namespace,
      chainRefByNamespace: createChainRefDefaults(admittedChains, primaryChain.chainRef),
    },
  };
};
