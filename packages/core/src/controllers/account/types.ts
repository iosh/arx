import type { ChainRef } from "../../chains/ids.js";
import type { AccountId } from "../../db/records.js";
import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";

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

export type NamespaceStateChange = {
  namespace: ChainNamespace;
  state: NamespaceAccountsState;
};

export type MultiNamespaceAccountsState = {
  namespaces: Record<ChainNamespace, NamespaceAccountsState>;
};

export type AccountMessengerTopics = {
  "accounts:stateChanged": MultiNamespaceAccountsState;
  "accounts:namespaceChanged": NamespaceStateChange;
  "accounts:selectedChanged": { namespace: ChainNamespace; selectedAccountId: AccountId | null };
};

export const EMPTY_MULTI_NAMESPACE_STATE: MultiNamespaceAccountsState = {
  namespaces: {},
};

export type AccountMessenger = ControllerMessenger<AccountMessengerTopics>;

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

  requestAccounts(params: { origin: string; chainRef: ChainRef }): Promise<string[]>;

  onStateChanged(handler: (state: MultiNamespaceAccountsState) => void): () => void;
  onNamespaceChanged(handler: (payload: NamespaceStateChange) => void): () => void;
  onSelectedChanged(
    handler: (payload: { namespace: ChainNamespace; selectedAccountId: AccountId | null }) => void,
  ): () => void;

  destroy?: () => void;
};
