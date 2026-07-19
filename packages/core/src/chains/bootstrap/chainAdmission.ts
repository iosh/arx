import type { ChainRef } from "../../networks/chainRef.js";
import { parseChainRef } from "../../networks/chainRef.js";
import type { RpcEndpoint } from "../definition.js";
import { type ChainDefinitionSeed, cloneChainDefinition } from "../definition.js";
import { ChainAdmissionConfigError } from "../errors.js";

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
    const { namespace } = parseChainRef(seed.definition.chainRef);
    if (!(namespace in next)) {
      next[namespace] = seed.definition.chainRef;
    }
  }

  next[parseChainRef(selectedUiChainRef).namespace] = selectedUiChainRef;
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
      selectedNamespace: parseChainRef(primarySeed.definition.chainRef).namespace,
      chainRefByNamespace: createChainRefDefaults(admittedChainSeeds, primarySeed.definition.chainRef),
    },
  };
};
