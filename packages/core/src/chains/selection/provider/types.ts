import type { ChainRef } from "../../ids.js";
import type { Unsubscribe } from "../../../messenger/index.js";
import type { ProviderChainSelectionRecord } from "../../../storage/records.js";

export type ProviderChainSelectionKey = {
  origin: string;
  namespace: string;
};

export type ProviderChainSelectionChangedPayload = {
  origin: string;
  namespace: string;
  previous: ProviderChainSelectionRecord | null;
  next: ProviderChainSelectionRecord | null;
};

export type ProviderChainSelectionChangedHandler = (payload: ProviderChainSelectionChangedPayload) => void;

export type ProviderChainSelectionService = {
  subscribeChanged(handler: ProviderChainSelectionChangedHandler): Unsubscribe;
  loadAll(): Promise<ProviderChainSelectionRecord[]>;
  get(params: ProviderChainSelectionKey): Promise<ProviderChainSelectionRecord | null>;
  getSnapshot(params: ProviderChainSelectionKey): ProviderChainSelectionRecord | null;
  getSelectedChainRef(params: ProviderChainSelectionKey): ChainRef | null;
  setSelectedChainRef(
    params: ProviderChainSelectionKey & { chainRef: ChainRef },
  ): Promise<ProviderChainSelectionRecord>;
  clear(params: ProviderChainSelectionKey): Promise<void>;
};
