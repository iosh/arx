import type { ChainRef } from "../../../chains/ids.js";
import type { WalletChainSelectionRecord } from "../../../storage/records.js";
import type { Unsubscribe } from "../_shared/signal.js";

export type WalletChainSelectionChangedPayload = {
  previous: WalletChainSelectionRecord | null;
  next: WalletChainSelectionRecord;
};

export type WalletChainSelectionChangedHandler = (payload: WalletChainSelectionChangedPayload) => void;

export type UpdateWalletChainSelectionParams = {
  selectedNamespace?: string;
  chainRefByNamespace?: Record<string, ChainRef>;
  chainRefByNamespacePatch?: Record<string, ChainRef | null>;
};

export type WalletChainSelectionService = {
  subscribeChanged(handler: WalletChainSelectionChangedHandler): Unsubscribe;
  get(): Promise<WalletChainSelectionRecord | null>;
  getSnapshot(): WalletChainSelectionRecord | null;
  getSelectedNamespace(): string;
  getChainRefByNamespace(): Record<string, ChainRef>;
  getSelectedChainRef(namespace: string): ChainRef | null;
  update(params: UpdateWalletChainSelectionParams): Promise<WalletChainSelectionRecord>;
  selectNamespace(namespace: string): Promise<WalletChainSelectionRecord>;
  selectChain(chainRef: ChainRef): Promise<WalletChainSelectionRecord>;
};
