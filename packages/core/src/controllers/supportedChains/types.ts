import type { ChainRef } from "../../chains/ids.js";
import type { ChainMetadata } from "../../chains/metadata.js";

export type SupportedChainEntity = {
  chainRef: ChainRef;
  namespace: string;
  metadata: ChainMetadata;
  source: "builtin" | "custom";
  createdByOrigin?: string;
};

export type SupportedChainsState = {
  chains: SupportedChainEntity[];
};

export type SupportedChainsUpdate =
  | { kind: "added"; chain: SupportedChainEntity }
  | { kind: "updated"; chain: SupportedChainEntity; previous: SupportedChainEntity }
  | { kind: "removed"; chainRef: ChainRef; previous?: SupportedChainEntity };

export type AddSupportedChainOptions = {
  createdByOrigin?: string;
};

export type AddSupportedChainResult =
  | { kind: "added"; chain: SupportedChainEntity }
  | { kind: "updated"; chain: SupportedChainEntity; previous: SupportedChainEntity }
  | { kind: "noop"; chain: SupportedChainEntity };

export interface SupportedChainsController {
  getState(): SupportedChainsState;
  getChain(chainRef: ChainRef): SupportedChainEntity | null;
  listChains(): SupportedChainEntity[];
  addChain(chain: ChainMetadata, options?: AddSupportedChainOptions): Promise<AddSupportedChainResult>;
  removeChain(chainRef: ChainRef): Promise<{ removed: boolean; previous?: SupportedChainEntity }>;
  onStateChanged(handler: (state: SupportedChainsState) => void): () => void;
  onChainUpdated(handler: (update: SupportedChainsUpdate) => void): () => void;
  whenReady(): Promise<void>;
}
