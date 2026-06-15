import { getChainRefNamespace } from "../../chains/caip.js";
import { type ChainDefinitionSeed, cloneChainDefinition } from "../../chains/definition.js";
import type { ChainRef } from "../../chains/ids.js";
import type { RpcEndpoint } from "../../chains/metadata.js";
import { RuntimeConfigError } from "./errors.js";

export type RuntimeWalletChainSelectionDefaults = {
  selectedNamespace: string;
  chainRefByNamespace: Record<string, ChainRef>;
};

export type RuntimeChainAdmission = {
  admittedChainSeeds: ChainDefinitionSeed<RpcEndpoint>[];
  selectionDefaults: RuntimeWalletChainSelectionDefaults;
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

export const buildRuntimeChainAdmission = (params: {
  admittedChainSeeds: readonly ChainDefinitionSeed<RpcEndpoint>[];
}): RuntimeChainAdmission => {
  const admittedChainSeeds = params.admittedChainSeeds.map((seed) => ({
    definition: cloneChainDefinition(seed.definition),
    ...(seed.defaultRpcEndpoints ? { defaultRpcEndpoints: structuredClone(seed.defaultRpcEndpoints) } : {}),
  }));
  const primarySeed = admittedChainSeeds[0];
  if (!primarySeed) {
    throw new RuntimeConfigError({ reason: "missing_admitted_chain" });
  }

  return {
    admittedChainSeeds,
    selectionDefaults: {
      selectedNamespace: getChainRefNamespace(primarySeed.definition.chainRef),
      chainRefByNamespace: createChainRefDefaults(admittedChainSeeds, primarySeed.definition.chainRef),
    },
  };
};
