import type { ChainRef } from "../../chains/ids.js";
import type { AccountId } from "../../storage/records.js";

// Chain-canonical address string (eg. EVM lowercased 0x...).
export type AccountAddress = string;

export type ChainNamespace = string;

export type NamespaceChainContext = {
  namespace: ChainNamespace;
  chainRef: ChainRef;
};

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
   * Returns the namespace-scoped account list rendered for the given chain context.
   */
  getAccountsForNamespace(params: NamespaceChainContext): AccountAddress[];

  getAccountIdsForNamespace(namespace: ChainNamespace): AccountId[];
  getSelectedAccountId(namespace: ChainNamespace): AccountId | null;
  getSelectedPointerForNamespace(params: NamespaceChainContext): ActivePointer | null;
  getSelectedAddressForNamespace(params: NamespaceChainContext): AccountAddress | null;

  /**
   * Selects the active account for a namespace.
   * - address omitted/null => reset selection to the namespace default (first account)
   */
  switchActiveForNamespace(params: NamespaceChainContext & { address?: string | null }): Promise<ActivePointer | null>;

  /**
   * RPC-facing convenience wrapper for chain invocation contexts.
   */
  requestAccounts(params: { chainRef: ChainRef }): Promise<AccountAddress[]>;

  onStateChanged(handler: (state: MultiNamespaceAccountsState) => void): () => void;

  destroy?: () => void;
};
