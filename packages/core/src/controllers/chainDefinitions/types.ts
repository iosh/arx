import type { ChainRef } from "../../chains/ids.js";
import type { ChainDefinitionEntity } from "../../storage/index.js";

export type ChainDefinitionsState = {
  chains: ChainDefinitionEntity[];
};

export type ChainDefinitionsUpdate =
  | { kind: "added"; chain: ChainDefinitionEntity }
  | { kind: "updated"; chain: ChainDefinitionEntity; previous: ChainDefinitionEntity }
  | { kind: "removed"; chainRef: ChainRef; previous?: ChainDefinitionEntity };

export type ChainDefinitionsUpsertCustomOptions = {
  updatedAt?: number;
  schemaVersion?: number;
  createdByOrigin?: string;
};

export type ChainDefinitionsUpsertCustomResult =
  | { kind: "added"; chain: ChainDefinitionEntity }
  | { kind: "updated"; chain: ChainDefinitionEntity; previous: ChainDefinitionEntity }
  | { kind: "noop"; chain: ChainDefinitionEntity };

export interface ChainDefinitionsController {
  getState(): ChainDefinitionsState;
  getChain(chainRef: ChainRef): ChainDefinitionEntity | null;
  getChains(): ChainDefinitionEntity[];
  reconcileBuiltinChains(seed: readonly ChainDefinitionEntity["metadata"][]): Promise<void>;
  upsertCustomChain(
    chain: ChainDefinitionEntity["metadata"],
    options?: ChainDefinitionsUpsertCustomOptions,
  ): Promise<ChainDefinitionsUpsertCustomResult>;
  removeCustomChain(chainRef: ChainRef): Promise<{ removed: boolean; previous?: ChainDefinitionEntity }>;
  onStateChanged(handler: (state: ChainDefinitionsState) => void): () => void;
  onChainUpdated(handler: (update: ChainDefinitionsUpdate) => void): () => void;
  whenReady(): Promise<void>;
}
