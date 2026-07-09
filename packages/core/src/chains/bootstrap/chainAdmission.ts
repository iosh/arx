import { getChainRefNamespace } from "../caip.js";
import type { RpcEndpoint } from "../definition.js";
import { type ChainDefinitionSeed, cloneChainDefinition } from "../definition.js";
import { ChainAdmissionConfigError } from "../errors.js";
import type { ChainRef } from "../ids.js";

export type WalletChainSelectionDefaults = {
  selectedNamespace: string;
  chainRefByNamespace: Record<string, ChainRef>;
};

export type ChainAdmission = {
  admittedChainSeeds: ChainDefinitionSeed<RpcEndpoint>[];
  selectionDefaults: WalletChainSelectionDefaults;
};

const createChainRefDefaults = (
  admittedChainSeeds: readonly ChainDefinitionSeed<RpcEndpoint>[],
  selectedUiChainRef: ChainRef,
): Record<string, ChainRef> => {
  const next: Record<string, ChainRef> = {};

  for (const seed of admittedChainSeeds) {
    const namespace = getChainRefNamespace(seed.definition.chainRef);
    if (!(namespace in next)) {
      next[namespace] = seed.definition.chainRef;
    }
  }

  next[getChainRefNamespace(selectedUiChainRef)] = selectedUiChainRef;
  return next;
};

export const buildChainAdmission = (params: {
  admittedChainSeeds: readonly ChainDefinitionSeed<RpcEndpoint>[];
}): ChainAdmission => {
  const admittedChainSeeds = params.admittedChainSeeds.map((seed) => ({
    definition: cloneChainDefinition(seed.definition),
    ...(seed.defaultRpcEndpoints ? { defaultRpcEndpoints: structuredClone(seed.defaultRpcEndpoints) } : {}),
  }));
  const primarySeed = admittedChainSeeds[0];
  if (!primarySeed) {
    throw new ChainAdmissionConfigError("missing_admitted_chain");
  }

  return {
    admittedChainSeeds,
    selectionDefaults: {
      selectedNamespace: getChainRefNamespace(primarySeed.definition.chainRef),
      chainRefByNamespace: createChainRefDefaults(admittedChainSeeds, primarySeed.definition.chainRef),
    },
  };
};
