import type { Caip2ChainId } from "../../chains/ids.js";
import { type ChainModuleRegistry, createDefaultChainModuleRegistry, parseCaip2 } from "../../chains/index.js";
import type {
  AccountAddress,
  AccountMessenger,
  ActivePointer,
  ChainNamespace,
  MultiNamespaceAccountController,
  MultiNamespaceAccountsState,
  NamespaceAccountsState,
  NamespaceStateChange,
} from "./types.js";

const ACCOUNTS_TOPIC = "accounts:stateChanged";
const NAMESPACE_TOPIC = "accounts:namespaceChanged";
const ACTIVE_TOPIC = "accounts:activeChanged";

const emptyNamespaceState = <T extends string>(): NamespaceAccountsState<T> => ({
  all: [],
  primary: null,
});

const cloneNamespace = <T extends string>(state: NamespaceAccountsState<T>): NamespaceAccountsState<T> => ({
  all: [...state.all],
  primary: state.primary ?? null,
});

const clonePointer = <T extends string>(pointer: ActivePointer<T> | null): ActivePointer<T> | null => {
  if (!pointer) return null;
  return { namespace: pointer.namespace, chainRef: pointer.chainRef, address: pointer.address ?? null };
};

const cloneState = <T extends string>(state: MultiNamespaceAccountsState<T>): MultiNamespaceAccountsState<T> => {
  const entries = Object.entries(state.namespaces) as Array<[ChainNamespace, NamespaceAccountsState<T>]>;
  const namespaces = Object.fromEntries(entries.map(([ns, value]) => [ns, cloneNamespace(value)])) as Record<
    ChainNamespace,
    NamespaceAccountsState<T>
  >;
  return { namespaces, active: clonePointer(state.active) };
};

const isSameNamespace = <T extends string>(prev?: NamespaceAccountsState<T>, next?: NamespaceAccountsState<T>) => {
  if (!prev || !next) return false;
  if (prev.primary !== next.primary) return false;
  if (prev.all.length !== next.all.length) return false;
  return prev.all.every((value, index) => value === next.all[index]);
};

const isSamePointer = <T extends string>(prev?: ActivePointer<T> | null, next?: ActivePointer<T> | null) => {
  if (!prev || !next) return prev === next;
  return (
    prev.namespace === next.namespace &&
    prev.chainRef === next.chainRef &&
    (prev.address ?? null) === (next.address ?? null)
  );
};

const isSameState = <T extends string>(
  prev?: MultiNamespaceAccountsState<T>,
  next?: MultiNamespaceAccountsState<T>,
) => {
  if (!prev || !next) return false;
  const prevNamespaces = Object.keys(prev.namespaces);
  const nextNamespaces = Object.keys(next.namespaces);
  if (prevNamespaces.length !== nextNamespaces.length) return false;
  if (!prevNamespaces.every((ns) => isSameNamespace(prev.namespaces[ns], next.namespaces[ns]))) return false;
  return isSamePointer(prev.active, next.active);
};

type Options<T extends string> = {
  messenger: AccountMessenger<T>;
  chains?: ChainModuleRegistry;
  initialState?: MultiNamespaceAccountsState<T>;
};

export class InMemoryMultiNamespaceAccountsController<T extends string = string>
  implements MultiNamespaceAccountController<T>
{
  #messenger: AccountMessenger<T>;
  #chains: ChainModuleRegistry;
  #state: MultiNamespaceAccountsState<T>;

  constructor({ messenger, chains, initialState }: Options<T>) {
    this.#messenger = messenger;
    this.#chains = chains ?? createDefaultChainModuleRegistry();

    const baseState: MultiNamespaceAccountsState<T> =
      initialState ?? ({ namespaces: {}, active: null } as MultiNamespaceAccountsState<T>);
    this.#state = cloneState(baseState);

    const namespaces = Object.entries(this.#state.namespaces) as Array<[ChainNamespace, NamespaceAccountsState<T>]>;
    for (const [namespace, snapshot] of namespaces) {
      this.#publishNamespace(namespace, snapshot);
    }
    this.#publishActive(this.#state.active);
    this.#publishAll();
  }

  getState(): MultiNamespaceAccountsState<T> {
    return cloneState(this.#state);
  }

  getActivePointer(): ActivePointer<T> | null {
    return clonePointer(this.#state.active);
  }

  getAccounts(params?: { chainRef?: Caip2ChainId }): T[] {
    const chainRef = params?.chainRef ?? this.#state.active?.chainRef;
    if (!chainRef) return [];
    const namespace = this.#namespaceFor(chainRef);
    const record = this.#state.namespaces[namespace];
    return record ? [...record.all] : [];
  }

  getAccountsForNamespace(namespace: ChainNamespace): T[] {
    const record = this.#state.namespaces[namespace];
    return record ? [...record.all] : [];
  }

  async switchActive({
    chainRef,
    address,
  }: {
    chainRef: Caip2ChainId;
    address?: AccountAddress<T> | null;
  }): Promise<ActivePointer<T>> {
    const namespace = this.#namespaceFor(chainRef);
    const state = this.#getOrInitNamespaceState(namespace);
    const canonical = address != null ? this.#canonical(chainRef, address) : null;

    if (canonical && !state.all.includes(canonical)) {
      throw new Error(`Address ${canonical} is not registered for namespace "${namespace}"`);
    }

    const resolved = canonical ?? state.primary ?? (state.all.length > 0 ? state.all[0]! : null);

    const pointer: ActivePointer<T> = { namespace, chainRef, address: resolved ?? null };

    if (isSamePointer(this.#state.active, pointer)) {
      return clonePointer(pointer)!;
    }

    this.#state = {
      namespaces: { ...this.#state.namespaces, [namespace]: state },
      active: pointer,
    };
    this.#publishActive(pointer);
    this.#publishAll();
    return clonePointer(pointer)!;
  }

  async addAccount({
    chainRef,
    address,
    makePrimary,
  }: {
    chainRef: Caip2ChainId;
    address: AccountAddress<T>;
    makePrimary?: boolean;
  }): Promise<NamespaceAccountsState<T>> {
    const namespace = this.#namespaceFor(chainRef);
    const canonical = this.#canonical(chainRef, address);
    const current = this.#getOrInitNamespaceState(namespace);
    const exists = current.all.includes(canonical);
    const nextAll = exists ? [...current.all] : [...current.all, canonical];
    const shouldBePrimary = makePrimary ?? (!current.primary && nextAll.length > 0);
    const primary = shouldBePrimary ? canonical : (current.primary ?? nextAll[0] ?? null);
    const nextState: NamespaceAccountsState<T> = { all: nextAll, primary };

    if (isSameNamespace(current, nextState)) {
      return cloneNamespace(nextState);
    }

    this.#state = {
      namespaces: { ...this.#state.namespaces, [namespace]: nextState },
      active: this.#syncActive(namespace, nextState),
    };

    this.#publishNamespace(namespace, nextState);
    this.#publishAll();
    return cloneNamespace(nextState);
  }

  async removeAccount({
    chainRef,
    address,
  }: {
    chainRef: Caip2ChainId;
    address: AccountAddress<T>;
  }): Promise<NamespaceAccountsState<T>> {
    const namespace = this.#namespaceFor(chainRef);
    const canonical = this.#canonical(chainRef, address);
    const current = this.#getOrInitNamespaceState(namespace);
    if (!current.all.includes(canonical)) {
      return cloneNamespace(current);
    }

    const nextAll = current.all.filter((value) => value !== canonical);
    const primary = current.primary === canonical ? (nextAll[0] ?? null) : current.primary;
    const nextState: NamespaceAccountsState<T> = { all: nextAll, primary: primary ?? null };
    this.#state = {
      namespaces: { ...this.#state.namespaces, [namespace]: nextState },
      active: this.#syncActive(namespace, nextState),
    };
    this.#publishNamespace(namespace, nextState);
    this.#publishAll();
    return cloneNamespace(nextState);
  }

  async requestAccounts({
    origin,
    chainRef,
  }: {
    origin: string;
    chainRef: Caip2ChainId;
  }): Promise<AccountAddress<T>[]> {
    void origin; // currently unused, reserved for future

    const namespace = this.#namespaceFor(chainRef);
    const current = this.#getOrInitNamespaceState(namespace);

    if (!current.primary && current.all.length > 0) {
      const nextState: NamespaceAccountsState<T> = {
        all: [...current.all],
        primary: current.all[0] ?? null,
      };
      this.#state = {
        namespaces: { ...this.#state.namespaces, [namespace]: nextState },
        active: this.#syncActive(namespace, nextState),
      };
      this.#publishNamespace(namespace, nextState);
      this.#publishAll();
      return [...nextState.all];
    }
    return [...current.all];
  }

  replaceState(state: MultiNamespaceAccountsState<T>): void {
    const cloned = cloneState(state);
    this.#state = cloned;
    this.#publishAll();
  }

  onStateChanged(handler: (state: MultiNamespaceAccountsState<T>) => void): () => void {
    return this.#messenger.subscribe(ACCOUNTS_TOPIC, handler);
  }

  onNamespaceChanged(handler: (payload: NamespaceStateChange<T>) => void): () => void {
    return this.#messenger.subscribe(NAMESPACE_TOPIC, handler);
  }

  onActiveChanged(handler: (pointer: ActivePointer<T> | null) => void): () => void {
    return this.#messenger.subscribe(ACTIVE_TOPIC, handler);
  }

  #canonical(chainRef: Caip2ChainId, address: AccountAddress<T>): AccountAddress<T> {
    const result = this.#chains.normalizeAddress({ chainRef, value: address });
    return result.canonical as AccountAddress<T>;
  }

  #getOrInitNamespaceState(namespace: ChainNamespace): NamespaceAccountsState<T> {
    const existing = this.#state.namespaces[namespace];
    if (existing) return cloneNamespace(existing);
    const fresh = emptyNamespaceState<T>();
    this.#state = {
      namespaces: { ...this.#state.namespaces, [namespace]: fresh },
      active: this.#state.active,
    };
    return cloneNamespace(fresh);
  }

  #namespaceFor(chainRef: Caip2ChainId): ChainNamespace {
    const { namespace } = parseCaip2(chainRef);
    return namespace;
  }

  #syncActive(namespace: ChainNamespace, state: NamespaceAccountsState<T>): ActivePointer<T> | null {
    const pointer = this.#state.active;
    if (!pointer || pointer.namespace !== namespace) {
      return clonePointer(pointer);
    }
    const address =
      pointer.address && state.all.includes(pointer.address)
        ? pointer.address
        : (state.primary ?? state.all[0] ?? null);
    const updated: ActivePointer<T> = { namespace, chainRef: pointer.chainRef, address: address ?? null };
    if (isSamePointer(pointer, updated)) {
      return clonePointer(pointer);
    }
    this.#publishActive(updated);
    return updated;
  }

  #publishAll(): void {
    this.#messenger.publish(ACCOUNTS_TOPIC, cloneState(this.#state), { compare: isSameState });
  }

  #publishNamespace(namespace: ChainNamespace, state: NamespaceAccountsState<T>): void {
    this.#messenger.publish(
      NAMESPACE_TOPIC,
      { namespace, state: cloneNamespace(state) },
      {
        compare: (prev, next) => {
          if (!prev || !next) return false;
          if (prev.namespace !== next.namespace) return false;
          return isSameNamespace(prev.state, next.state);
        },
      },
    );
  }

  #publishActive(pointer: ActivePointer<T> | null): void {
    this.#messenger.publish(ACTIVE_TOPIC, clonePointer(pointer), { compare: isSamePointer });
  }
}
