import type { ChainDefinition } from "../definition.js";
import type { ChainRef } from "../ids.js";

/** @deprecated Replaced by the Networks owner and retained until legacy RPC handlers are removed. */
export type ChainDefinitionEntity = {
  chainRef: ChainRef;
  namespace: string;
  definition: ChainDefinition;
  schemaVersion: 1;
  updatedAt: number;
  source: "builtin" | "custom";
  createdByOrigin?: string | undefined;
};

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

export interface ChainDefinitionsService {
  getState(): ChainDefinitionsState;
  getChain(chainRef: ChainRef): ChainDefinitionEntity | null;
  getChains(): ChainDefinitionEntity[];
  reconcileBuiltinChains(seed: readonly ChainDefinition[]): Promise<void>;
  upsertCustomChain(
    chain: ChainDefinition,
    options?: ChainDefinitionsUpsertCustomOptions,
  ): Promise<ChainDefinitionsUpsertCustomResult>;
  removeCustomChain(chainRef: ChainRef): Promise<{ removed: boolean; previous?: ChainDefinitionEntity }>;
  onStateChanged(handler: (state: ChainDefinitionsState) => void): () => void;
  onChainUpdated(handler: (update: ChainDefinitionsUpdate) => void): () => void;
  whenReady(): Promise<void>;
}
