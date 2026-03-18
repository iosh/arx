import type { ChainRef } from "../../chains/ids.js";
import type { AccountKey } from "../../storage/records.js";

// Chain-canonical address string (eg. EVM lowercased 0x...).
export type AccountAddress = string;

export type ChainNamespace = string;

export type NamespaceChainContext = {
  namespace: ChainNamespace;
  chainRef: ChainRef;
};

export type OwnedAccountView = {
  accountKey: AccountKey;
  namespace: ChainNamespace;
  canonicalAddress: AccountAddress;
  displayAddress: string;
};

export type NamespaceAccountsState = {
  accountKeys: AccountKey[];
  selectedAccountKey: AccountKey | null;
};

export type ActiveAccountView = OwnedAccountView & {
  chainRef: ChainRef;
};

export type ActivePointer = ActiveAccountView;

export type MultiNamespaceAccountsState = {
  namespaces: Record<ChainNamespace, NamespaceAccountsState>;
};

export const EMPTY_MULTI_NAMESPACE_STATE: MultiNamespaceAccountsState = {
  namespaces: {},
};

export type AccountController = {
  getState(): MultiNamespaceAccountsState;

  listOwnedForNamespace(params: NamespaceChainContext): OwnedAccountView[];
  getOwnedAccount(params: NamespaceChainContext & { accountKey: AccountKey }): OwnedAccountView | null;

  getAccountKeysForNamespace(namespace: ChainNamespace): AccountKey[];
  getSelectedAccountKey(namespace: ChainNamespace): AccountKey | null;
  getActiveAccountForNamespace(params: NamespaceChainContext): ActiveAccountView | null;

  /**
   * Selects the active account for a namespace.
   * - accountKey omitted/null => reset selection to the namespace default (first account)
   */
  setActiveAccount(
    params: NamespaceChainContext & { accountKey?: AccountKey | null },
  ): Promise<ActiveAccountView | null>;

  onStateChanged(handler: (state: MultiNamespaceAccountsState) => void): () => void;

  whenReady?: () => Promise<void>;
  destroy?: () => void;
};
