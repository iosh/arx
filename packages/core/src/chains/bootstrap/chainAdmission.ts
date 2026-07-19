import type { ChainRef } from "../../networks/chainRef.js";
import { parseChainRef } from "../../networks/chainRef.js";
import { cloneChainDefinition } from "../../networks/definition.js";
import type { BuiltinNetworkSeed } from "../../networks/types.js";
import { ChainAdmissionConfigError } from "../errors.js";

export type WalletChainSelectionDefaults = {
  selectedNamespace: string;
  chainRefByNamespace: Record<string, ChainRef>;
};

export type ChainAdmission = {
  admittedChainSeeds: BuiltinNetworkSeed[];
  selectionDefaults: WalletChainSelectionDefaults;
};

const createChainRefDefaults = (
  admittedChainSeeds: readonly BuiltinNetworkSeed[],
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

export const buildChainAdmission = (params: { admittedChainSeeds: readonly BuiltinNetworkSeed[] }): ChainAdmission => {
  const admittedChainSeeds = params.admittedChainSeeds.map((seed) => ({
    definition: cloneChainDefinition(seed.definition),
    defaultRpcEndpoints: [...seed.defaultRpcEndpoints] as const,
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
