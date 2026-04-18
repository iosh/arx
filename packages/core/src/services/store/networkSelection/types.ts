import type { ChainRef } from "../../../chains/ids.js";
import type { NetworkSelectionRecord } from "../../../storage/records.js";
import type { Unsubscribe } from "../_shared/signal.js";

export type NetworkSelectionChangedPayload = {
  previous: NetworkSelectionRecord | null;
  next: NetworkSelectionRecord;
};

export type NetworkSelectionChangedHandler = (payload: NetworkSelectionChangedPayload) => void;

export type UpdateNetworkSelectionParams =
  | {
      selectedNamespace?: string;
      chainRefByNamespace?: Record<string, ChainRef>;
      chainRefByNamespacePatch?: Record<string, ChainRef | null>;
    }
  | {
      selectedNamespace?: string;
      chainRefByNamespace?: Record<string, ChainRef>;
      chainRefByNamespacePatch?: Record<string, ChainRef | null>;
    };

export type NetworkSelectionService = {
  subscribeChanged(handler: NetworkSelectionChangedHandler): Unsubscribe;
  get(): Promise<NetworkSelectionRecord | null>;
  getSnapshot(): NetworkSelectionRecord | null;
  getSelectedNamespace(): string;
  getChainRefByNamespace(): Record<string, ChainRef>;
  getSelectedChainRef(namespace: string): ChainRef | null;
  update(params: UpdateNetworkSelectionParams): Promise<NetworkSelectionRecord>;
  selectNamespace(namespace: string): Promise<NetworkSelectionRecord>;
  selectChain(chainRef: ChainRef): Promise<NetworkSelectionRecord>;
};
