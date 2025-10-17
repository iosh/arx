import type { Caip2ChainId } from "../../chains/ids.js";
import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import type { ChainRegistryEntity } from "../../storage/index.js";

export type ChainRegistryState = {
  chains: ChainRegistryEntity[];
};

export type ChainRegistryUpdate =
  | { kind: "added"; chain: ChainRegistryEntity }
  | { kind: "updated"; chain: ChainRegistryEntity; previous: ChainRegistryEntity }
  | { kind: "removed"; chainRef: Caip2ChainId; previous?: ChainRegistryEntity };

export type ChainRegistryMessengerTopics = {
  "chainRegistry:stateChanged": ChainRegistryState;
  "chainRegistry:updated": ChainRegistryUpdate;
};

export type ChainRegistryMessenger = ControllerMessenger<ChainRegistryMessengerTopics>;

export type ChainRegistryUpsertOptions = {
  updatedAt?: number;
  schemaVersion?: number;
};

export interface ChainRegistryController {
  getState(): ChainRegistryState;
  getChain(chainRef: Caip2ChainId): ChainRegistryEntity | null;
  getChains(): ChainRegistryEntity[];
  upsertChain(
    chain: ChainRegistryEntity["metadata"],
    options?: ChainRegistryUpsertOptions,
  ): Promise<{ kind: "added" | "updated"; chain: ChainRegistryEntity; previous?: ChainRegistryEntity }>;
  removeChain(chainRef: Caip2ChainId): Promise<{ removed: boolean; previous?: ChainRegistryEntity }>;
  onStateChanged(handler: (state: ChainRegistryState) => void): () => void;
  onChainUpdated(handler: (update: ChainRegistryUpdate) => void): () => void;
  whenReady(): Promise<void>;
}
