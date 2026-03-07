import type { ChainRef } from "../../chains/ids.js";
import type { ChainDefinitionEntity } from "../../storage/index.js";

export type ChainDefinitionsState = {
  chains: ChainDefinitionEntity[];
};

export type ChainDefinitionsUpdate =
  | { kind: "added"; chain: ChainDefinitionEntity }
  | { kind: "updated"; chain: ChainDefinitionEntity; previous: ChainDefinitionEntity }
  | { kind: "removed"; chainRef: ChainRef; previous?: ChainDefinitionEntity };

export type ChainDefinitionsUpsertOptions = {
  updatedAt?: number;
  schemaVersion?: number;
};

export type ChainDefinitionsUpsertResult =
  | { kind: "added"; chain: ChainDefinitionEntity }
  | { kind: "updated"; chain: ChainDefinitionEntity; previous: ChainDefinitionEntity }
  | { kind: "noop"; chain: ChainDefinitionEntity };

export interface ChainDefinitionsController {
  getState(): ChainDefinitionsState;
  getChain(chainRef: ChainRef): ChainDefinitionEntity | null;
  getChains(): ChainDefinitionEntity[];
  upsertChain(
    chain: ChainDefinitionEntity["metadata"],
    options?: ChainDefinitionsUpsertOptions,
  ): Promise<ChainDefinitionsUpsertResult>;
  removeChain(chainRef: ChainRef): Promise<{ removed: boolean; previous?: ChainDefinitionEntity }>;
  onStateChanged(handler: (state: ChainDefinitionsState) => void): () => void;
  onChainUpdated(handler: (update: ChainDefinitionsUpdate) => void): () => void;
  whenReady(): Promise<void>;
}
