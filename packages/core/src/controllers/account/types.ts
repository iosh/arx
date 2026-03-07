import type { ChainRef } from "../../chains/ids.js";
import type { AccountId } from "../../storage/records.js";

// Chain-canonical address string (eg. EVM lowercased 0x...).
export type AccountAddress = string;

export type ChainNamespace = string;

export type NamespaceChainContext = {
  namespace: ChainNamespace;
  chainRef: ChainRef;
};

export type OwnedAccountView = {
  accountId: AccountId;
  namespace: ChainNamespace;
  canonicalAddress: AccountAddress;
  displayAddress: string;
};

export type NamespaceAccountsState = {
  accountIds: AccountId[];
  selectedAccountId: AccountId | null;
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
  getOwnedAccount(params: NamespaceChainContext & { accountId: AccountId }): OwnedAccountView | null;

  getAccountIdsForNamespace(namespace: ChainNamespace): AccountId[];
  getSelectedAccountId(namespace: ChainNamespace): AccountId | null;
  getActiveAccountForNamespace(params: NamespaceChainContext): ActiveAccountView | null;

  /**
   * Selects the active account for a namespace.
   * - accountId omitted/null => reset selection to the namespace default (first account)
   */
  setActiveAccount(params: NamespaceChainContext & { accountId?: AccountId | null }): Promise<ActiveAccountView | null>;

  onStateChanged(handler: (state: MultiNamespaceAccountsState) => void): () => void;

  whenReady?: () => Promise<void>;
  destroy?: () => void;
};
