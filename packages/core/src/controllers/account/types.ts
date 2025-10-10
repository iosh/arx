import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";

export type AccountAddress<T extends string = string> = T;

export type AccountsState<T extends string = string> = {
  all: AccountAddress<T>[];
  primary: AccountAddress<T> | null;
};

export type AccountMessengerTopics<T extends string = string> = {
  "account:stateChanged": AccountsState<T>;
};

export type AccountMessenger<T extends string = string> = ControllerMessenger<AccountMessengerTopics<T>>;

export type AccountController<T extends string = string> = {
  getAccounts(): AccountAddress<T>[];
  getPrimaryAccount(): AccountAddress<T> | null;
  requestAccounts(origin: string): Promise<AccountAddress<T>[]>;
  addAccount(account: AccountAddress<T>, options?: { makePrimary?: boolean }): Promise<AccountsState<T>>;
  onAccountsChanged(handler: (state: AccountsState<T>) => void): () => void;
  replaceState(state: AccountsState<T>): void;
};
