import type { ChainRef } from "../../chains/ids.js";
import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";

export type AccountAddress<T extends string = string> = T;

export type AccountsState<T extends string = string> = {
  all: AccountAddress<T>[];
  primary: AccountAddress<T> | null;
};

export type ChainNamespace = string;

export type NamespaceAccountsState<T extends string = string> = AccountsState<T>;

export type ActivePointer<T extends string = string> = {
  namespace: ChainNamespace;
  chainRef: ChainRef;
  address: AccountAddress<T> | null;
};

export type NamespaceStateChange<T extends string = string> = {
  namespace: ChainNamespace;
  state: NamespaceAccountsState<T>;
};

export type MultiNamespaceAccountsState<T extends string = string> = {
  namespaces: Record<ChainNamespace, NamespaceAccountsState<T>>;
  active: ActivePointer<T> | null;
};

export type AccountMessengerTopics<T extends string = string> = {
  "account:stateChanged": AccountsState<T>;
  "accounts:stateChanged": MultiNamespaceAccountsState<T>;
  "accounts:namespaceChanged": NamespaceStateChange<T>;
  "accounts:activeChanged": ActivePointer<T> | null;
};

export const EMPTY_MULTI_NAMESPACE_STATE: MultiNamespaceAccountsState = {
  namespaces: {},
  active: null,
};

export type AccountMessenger<T extends string = string> = ControllerMessenger<AccountMessengerTopics<T>>;

export type MultiNamespaceAccountController<T extends string = string> = {
  getState(): MultiNamespaceAccountsState<T>;
  getActivePointer(): ActivePointer<T> | null;
  getAccounts(params?: { chainRef?: ChainRef }): AccountAddress<T>[];
  getAccountsForNamespace(namespace: ChainNamespace): AccountAddress<T>[];
  switchActive(params: { chainRef: ChainRef; address?: AccountAddress<T> | null }): Promise<ActivePointer<T>>;
  addAccount(params: {
    chainRef: ChainRef;
    address: AccountAddress<T>;
    makePrimary?: boolean;
  }): Promise<NamespaceAccountsState<T>>;
  removeAccount(params: { chainRef: ChainRef; address: AccountAddress<T> }): Promise<NamespaceAccountsState<T>>;
  requestAccounts(params: { origin: string; chainRef: ChainRef }): Promise<AccountAddress<T>[]>;
  replaceState(state: MultiNamespaceAccountsState<T>): void;
  onStateChanged(handler: (state: MultiNamespaceAccountsState<T>) => void): () => void;
  onNamespaceChanged(handler: (payload: NamespaceStateChange<T>) => void): () => void;
  onActiveChanged(handler: (pointer: ActivePointer<T> | null) => void): () => void;
};

export type AccountController<T extends string = string> = MultiNamespaceAccountController<T>;
