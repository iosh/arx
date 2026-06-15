import type { ChainRef } from "../../ids.js";
import type { ChainDefinition } from "../../metadata.js";

export type SupportedChainEntity = {
  chainRef: ChainRef;
  namespace: string;
  definition: ChainDefinition;
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

export interface SupportedChainsService {
  getState(): SupportedChainsState;
  getChain(chainRef: ChainRef): SupportedChainEntity | null;
  listChains(): SupportedChainEntity[];
  addChain(chain: ChainDefinition, options?: AddSupportedChainOptions): Promise<AddSupportedChainResult>;
  removeChain(chainRef: ChainRef): Promise<{ removed: boolean; previous?: SupportedChainEntity }>;
  onStateChanged(handler: (state: SupportedChainsState) => void): () => void;
  onChainUpdated(handler: (update: SupportedChainsUpdate) => void): () => void;
  whenReady(): Promise<void>;
}
