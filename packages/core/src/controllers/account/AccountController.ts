import type { AccountAddress, AccountController, AccountMessenger, AccountsState } from "./types.js";

const ACCOUNT_STATE_TOPIC = "account:stateChanged";

export type AccountControllerOptions<T extends AccountAddress = AccountAddress> = {
  messenger: AccountMessenger<T>;
  initialState?: AccountsState<T>;
};

const cloneState = <T extends AccountAddress>(state: AccountsState<T>): AccountsState<T> => ({
  all: [...state.all],
  primary: state.primary ?? null,
});

const isSameState = <T extends AccountAddress>(prev?: AccountsState<T>, next?: AccountsState<T>) => {
  if (!prev || !next) return false;

  if (prev.primary !== next.primary) return false;

  if (prev.all.length !== next.all.length) return false;

  return prev.all.every((address, index) => address === next.all[index]);
};

export class InMemoryAccountController<T extends AccountAddress = AccountAddress> implements AccountController<T> {
  #messenger: AccountMessenger<T>;

  #state: AccountsState<T>;

  constructor({ messenger, initialState }: AccountControllerOptions<T>) {
    this.#messenger = messenger;
    this.#state = cloneState(initialState ?? { all: [], primary: null });
    this.#publishState();
  }

  getAccounts = (): T[] => {
    return [...this.#state.all];
  };

  getPrimaryAccount(): T | null {
    return this.#state.primary ?? null;
  }

  async requestAccounts(_origin: string): Promise<T[]> {
    if (!this.#state.primary && this.#state.all.length > 0) {
      this.#state = {
        all: [...this.#state.all],
        primary: this.#state.all[0] || null,
      };
      this.#publishState();
    }
    return this.getAccounts();
  }

  async addAccount(account: T, options?: { makePrimary?: boolean }): Promise<AccountsState<T>> {
    const exists = this.#state.all.includes(account);
    const nextAll = exists ? [...this.#state.all] : [...this.#state.all, account];
    const shouldBePrimary = options?.makePrimary ?? (!this.#state.primary && nextAll.length > 0);
    const resolvedPrimary = shouldBePrimary ? account : (this.#state.primary ?? nextAll[0] ?? null);

    const nextState: AccountsState<T> = {
      all: nextAll,
      primary: resolvedPrimary ?? null,
    };

    if (isSameState(this.#state, nextState)) {
      return cloneState(this.#state);
    }

    this.#state = nextState;
    this.#publishState();
    return cloneState(this.#state);
  }

  replaceState(state: AccountsState<T>): void {
    if (isSameState(this.#state, state)) {
      return;
    }

    this.#state = cloneState(state);
    this.#publishState();
  }
  onAccountsChanged(handler: (state: AccountsState<T>) => void): () => void {
    return this.#messenger.subscribe(ACCOUNT_STATE_TOPIC, handler);
  }

  #publishState() {
    this.#messenger.publish(ACCOUNT_STATE_TOPIC, cloneState(this.#state), {
      compare: isSameState,
    });
  }
}
