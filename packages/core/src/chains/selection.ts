import { getChainRefNamespace } from "./caip.js";
import type { ChainRef } from "./ids.js";
import type { WalletChainSelectionRecord } from "./persistence.js";

export type WalletChainSelectionDefaults = Readonly<{
  activeNamespace: string;
  chainRefByNamespace: Readonly<Record<string, ChainRef>>;
}>;

const cloneSelection = (record: WalletChainSelectionRecord): WalletChainSelectionRecord => structuredClone(record);

export const createWalletChainSelection = (
  defaults: WalletChainSelectionDefaults,
  stored: WalletChainSelectionRecord | null,
): WalletChainSelectionRecord => ({
  activeNamespace: stored?.activeNamespace ?? defaults.activeNamespace,
  chainRefByNamespace: {
    ...defaults.chainRefByNamespace,
    ...(stored?.chainRefByNamespace ?? {}),
  },
});

export const selectWalletNamespace = (
  current: WalletChainSelectionRecord,
  namespace: string,
): WalletChainSelectionRecord => ({
  ...cloneSelection(current),
  activeNamespace: namespace,
});

export const selectWalletChain = (
  current: WalletChainSelectionRecord,
  chainRef: ChainRef,
): WalletChainSelectionRecord => {
  const namespace = getChainRefNamespace(chainRef);
  return {
    activeNamespace: namespace,
    chainRefByNamespace: { ...current.chainRefByNamespace, [namespace]: chainRef },
  };
};

/** Owns the active wallet namespace and one selected chain per namespace. */
export class WalletChainSelection {
  #record: WalletChainSelectionRecord;

  constructor(record: WalletChainSelectionRecord) {
    this.#record = cloneSelection(record);
  }

  get(): WalletChainSelectionRecord {
    return cloneSelection(this.#record);
  }

  getChainRef(namespace: string): ChainRef | null {
    return this.#record.chainRefByNamespace[namespace] ?? null;
  }

  replace(record: WalletChainSelectionRecord): void {
    this.#record = cloneSelection(record);
  }
}
