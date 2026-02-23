import type { ChainRef } from "../../chains/ids.js";
import type { ChainRegistryEntity } from "../../storage/index.js";

export type ChainRegistryState = {
  chains: ChainRegistryEntity[];
};

export type ChainRegistryUpdate =
  | { kind: "added"; chain: ChainRegistryEntity }
  | { kind: "updated"; chain: ChainRegistryEntity; previous: ChainRegistryEntity }
  | { kind: "removed"; chainRef: ChainRef; previous?: ChainRegistryEntity };

export type ChainRegistryUpsertOptions = {
  updatedAt?: number;
  schemaVersion?: number;
};

export type ChainRegistryUpsertResult =
  | { kind: "added"; chain: ChainRegistryEntity }
  | { kind: "updated"; chain: ChainRegistryEntity; previous: ChainRegistryEntity }
  | { kind: "noop"; chain: ChainRegistryEntity };

export interface ChainRegistryController {
  getState(): ChainRegistryState;
  getChain(chainRef: ChainRef): ChainRegistryEntity | null;
  getChains(): ChainRegistryEntity[];
  upsertChain(
    chain: ChainRegistryEntity["metadata"],
    options?: ChainRegistryUpsertOptions,
  ): Promise<ChainRegistryUpsertResult>;
  removeChain(chainRef: ChainRef): Promise<{ removed: boolean; previous?: ChainRegistryEntity }>;
  onStateChanged(handler: (state: ChainRegistryState) => void): () => void;
  onChainUpdated(handler: (update: ChainRegistryUpdate) => void): () => void;
  whenReady(): Promise<void>;
}
