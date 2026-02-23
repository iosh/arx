import type { ChainRef } from "../../chains/ids.js";
import type { AccountId } from "../../storage/records.js";

// Chain-canonical address string (eg. EVM lowercased 0x...).
export type AccountAddress = string;

export type ChainNamespace = string;

export type NamespaceAccountsState = {
  accountIds: AccountId[];
  selectedAccountId: AccountId | null;
};

export type ActivePointer = {
  namespace: ChainNamespace;
  chainRef: ChainRef;
  accountId: AccountId;
  address: AccountAddress;
};

export type MultiNamespaceAccountsState = {
  namespaces: Record<ChainNamespace, NamespaceAccountsState>;
};

export const EMPTY_MULTI_NAMESPACE_STATE: MultiNamespaceAccountsState = {
  namespaces: {},
};

export type AccountController = {
  getState(): MultiNamespaceAccountsState;

  /**
   * Returns chain-canonical addresses for the given chainRef.
   */
  getAccounts(params: { chainRef: ChainRef }): AccountAddress[];

  getAccountIdsForNamespace(namespace: ChainNamespace): AccountId[];
  getSelectedAccountId(namespace: ChainNamespace): AccountId | null;
  getSelectedPointer(params: { chainRef: ChainRef }): ActivePointer | null;
  getSelectedAddress(params: { chainRef: ChainRef }): AccountAddress | null;

  /**
   * Selects the active account for the chain's namespace.
   * - address omitted/null => reset selection to the namespace default (first account)
   */
  switchActive(params: { chainRef: ChainRef; address?: string | null }): Promise<ActivePointer | null>;

  requestAccounts(params: { chainRef: ChainRef }): Promise<AccountAddress[]>;

  onStateChanged(handler: (state: MultiNamespaceAccountsState) => void): () => void;

  destroy?: () => void;
};
