import { getAccountCodec } from "../../accounts/codec.js";
import type { ChainRef } from "../../chains/ids.js";
import { type ChainModuleRegistry, createDefaultChainModuleRegistry, parseChainRef } from "../../chains/index.js";
import type { AccountId } from "../../db/records.js";
import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import type { AccountsService } from "../../services/accounts/types.js";
import type { SettingsService } from "../../services/settings/types.js";
import type { NetworkController } from "../network/types.js";
import type {
  AccountAddress,
  AccountController,
  AccountMessengerTopics,
  ActivePointer,
  ChainNamespace,
  MultiNamespaceAccountsState,
  NamespaceAccountsState,
  NamespaceStateChange,
} from "./types.js";

const TOPIC_STATE = "accounts:stateChanged";
const TOPIC_NAMESPACE = "accounts:namespaceChanged";
const TOPIC_ACTIVE = "accounts:activeChanged";

const emptyNamespaceState = <T extends string>(): NamespaceAccountsState<T> => ({ all: [], primary: null });

const cloneNamespace = <T extends string>(state: NamespaceAccountsState<T>): NamespaceAccountsState<T> => ({
  all: [...state.all],
  primary: state.primary ?? null,
});

const clonePointer = <T extends string>(pointer: ActivePointer<T> | null): ActivePointer<T> | null => {
  if (!pointer) return null;
  return { namespace: pointer.namespace, chainRef: pointer.chainRef, address: pointer.address ?? null };
};

const cloneState = <T extends string>(state: MultiNamespaceAccountsState<T>): MultiNamespaceAccountsState<T> => {
  const namespaces = Object.fromEntries(
    Object.entries(state.namespaces).map(([ns, value]) => [ns, cloneNamespace(value as NamespaceAccountsState<T>)]),
  ) as Record<ChainNamespace, NamespaceAccountsState<T>>;
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

const toSelectedAddress = (
  accountId: AccountId | null,
  params: { chainRef: ChainRef; chains: ChainModuleRegistry },
): string | null => {
  if (!accountId) return null;
  const { namespace } = parseChainRef(params.chainRef);
  if (!accountId.startsWith(`${namespace}:`)) return null;

  try {
    const codec = getAccountCodec(namespace);
    const canonical = codec.fromAccountId(accountId);
    if (canonical.namespace !== namespace) return null;
    const display = codec.toDisplayAddress({ chainRef: params.chainRef, canonical });
    return params.chains.toCanonicalAddress({ chainRef: params.chainRef, value: display }).canonical;
  } catch {
    return null;
  }
};

const toAccountId = (params: { namespace: string; chainRef: ChainRef; address: string }): AccountId => {
  const codec = getAccountCodec(params.namespace);
  const canonical = codec.toCanonicalAddress({ chainRef: params.chainRef, value: params.address });
  return codec.toAccountId(canonical);
};

type Options<T extends string> = {
  messenger: ControllerMessenger<AccountMessengerTopics<T>>;
  accounts: AccountsService;
  network: Pick<NetworkController, "getActiveChain" | "onChainChanged">;
  settings?: SettingsService | null;
  chains?: ChainModuleRegistry;
  now?: () => number;
  logger?: (message: string, error?: unknown) => void;
};

export class StoreAccountsController<T extends string = string> implements AccountController<T> {
  #messenger: ControllerMessenger<AccountMessengerTopics<T>>;
  #accounts: AccountsService;
  #settings: SettingsService | null;
  #network: Pick<NetworkController, "getActiveChain" | "onChainChanged">;
  #chains: ChainModuleRegistry;
  #now: () => number;
  #logger?: ((message: string, error?: unknown) => void) | undefined;

  #state: MultiNamespaceAccountsState<T> = { namespaces: {}, active: null } as MultiNamespaceAccountsState<T>;
  #selectedOverride: AccountId | null = null;
  #refreshPromise: Promise<void> | null = null;
  #subscriptions: Array<() => void> = [];
  #onAccountsChanged = () => void this.refresh();
  #onSettingsChanged = () => void this.refresh();

  constructor({ messenger, accounts, settings, network, chains, now, logger }: Options<T>) {
    this.#messenger = messenger;
    this.#accounts = accounts;
    this.#settings = settings ?? null;
    this.#network = network;
    this.#chains = chains ?? createDefaultChainModuleRegistry();
    this.#now = now ?? Date.now;
    this.#logger = logger;

    this.#subscriptions.push(
      this.#network.onChainChanged(() => {
        void this.refresh();
      }),
    );

    this.#accounts.on("changed", this.#onAccountsChanged);
    this.#settings?.on("changed", this.#onSettingsChanged);

    void this.refresh();
  }

  destroy() {
    try {
      this.#accounts.off("changed", this.#onAccountsChanged);
    } catch (error) {
      this.#logger?.("accounts: failed to remove accounts store listener", error);
    }
    try {
      this.#settings?.off("changed", this.#onSettingsChanged);
    } catch (error) {
      this.#logger?.("accounts: failed to remove settings listener", error);
    }

    for (const unsub of this.#subscriptions.splice(0)) {
      try {
        unsub();
      } catch (error) {
        this.#logger?.("accounts: failed to remove subscription", error);
      }
    }
  }

  getState(): MultiNamespaceAccountsState<T> {
    return cloneState(this.#state);
  }

  getActivePointer(): ActivePointer<T> | null {
    return clonePointer(this.#state.active);
  }

  getAccounts(params?: { chainRef?: ChainRef }): AccountAddress<T>[] {
    const chainRef = params?.chainRef ?? this.#state.active?.chainRef;
    if (!chainRef) return [];
    const { namespace } = parseChainRef(chainRef);
    const record = this.#state.namespaces[namespace];
    return record ? [...record.all] : [];
  }

  getAccountsForNamespace(namespace: ChainNamespace): AccountAddress<T>[] {
    const record = this.#state.namespaces[namespace];
    return record ? [...record.all] : [];
  }

  async switchActive(params: { chainRef: ChainRef; address?: AccountAddress<T> | null }): Promise<ActivePointer<T>> {
    const chainRef = params.chainRef;
    const { namespace } = parseChainRef(chainRef);
    const address = (params.address ?? null) as string | null;

    const current = this.#state.active;
    const requested = address
      ? (this.#chains.toCanonicalAddress({ chainRef, value: address }).canonical as AccountAddress<T>)
      : null;
    if (current?.chainRef === chainRef && (current.address ?? null) === requested) {
      return clonePointer(current)!;
    }

    let nextSelected: AccountId | null = null;
    if (address) {
      const candidate = toAccountId({ namespace, chainRef, address });
      const record = await this.#accounts.get(candidate);
      if (!record || record.hidden) {
        throw new Error(`Unknown account "${address}" for namespace "${namespace}"`);
      }
      nextSelected = candidate;
    }

    if (this.#settings) {
      await this.#settings.upsert({ selectedAccountId: nextSelected });
      this.#selectedOverride = null;
    } else {
      this.#selectedOverride = nextSelected;
    }

    await this.refresh();
    const pointer = this.#state.active;
    if (!pointer) {
      return { namespace, chainRef, address: null } as ActivePointer<T>;
    }
    return clonePointer(pointer)!;
  }

  async requestAccounts(params: { origin: string; chainRef: ChainRef }): Promise<AccountAddress<T>[]> {
    void params.origin;
    return this.getAccounts({ chainRef: params.chainRef });
  }

  async addAccount(): Promise<NamespaceAccountsState<T>> {
    throw new Error("StoreAccountsController.addAccount is deprecated; write via KeyringService");
  }
  async removeAccount(): Promise<NamespaceAccountsState<T>> {
    throw new Error("StoreAccountsController.removeAccount is deprecated; write via KeyringService");
  }
  replaceState(): void {
    throw new Error("StoreAccountsController.replaceState is deprecated");
  }

  onStateChanged(handler: (state: MultiNamespaceAccountsState<T>) => void): () => void {
    return this.#messenger.subscribe(TOPIC_STATE, handler);
  }

  onNamespaceChanged(handler: (payload: NamespaceStateChange<T>) => void): () => void {
    return this.#messenger.subscribe(TOPIC_NAMESPACE, handler);
  }

  onActiveChanged(handler: (pointer: ActivePointer<T> | null) => void): () => void {
    return this.#messenger.subscribe(TOPIC_ACTIVE, handler);
  }

  async refresh(): Promise<void> {
    if (this.#refreshPromise) return await this.#refreshPromise;

    this.#refreshPromise = (async () => {
      const activeChain = this.#network.getActiveChain();
      const { namespace } = parseChainRef(activeChain.chainRef);

      let selectedAccountId: AccountId | null = null;
      if (this.#settings) {
        try {
          const settings = await this.#settings.get();
          selectedAccountId = settings?.selectedAccountId ?? null;
        } catch (error) {
          this.#logger?.("accounts: failed to load settings", error);
          selectedAccountId = this.#selectedOverride;
        }
      } else {
        selectedAccountId = this.#selectedOverride;
      }

      const selectedAddress = toSelectedAddress(selectedAccountId, {
        chainRef: activeChain.chainRef,
        chains: this.#chains,
      });

      const records = await this.#accounts.list({ includeHidden: false });
      const sorted = [...records].sort((a, b) => a.createdAt - b.createdAt || a.accountId.localeCompare(b.accountId));
      const byNamespace = new Map<string, string[]>();
      for (const record of sorted) {
        const list = byNamespace.get(record.namespace) ?? [];
        list.push(`0x${record.payloadHex}`);
        byNamespace.set(record.namespace, list);
      }

      const namespaces = Object.fromEntries(
        Array.from(byNamespace.entries()).map(([ns, list]) => {
          const canonical = list.map((addr) => {
            try {
              return this.#chains.toCanonicalAddress({ chainRef: activeChain.chainRef, value: addr }).canonical;
            } catch {
              return addr;
            }
          });

          const uniq: string[] = [];
          const seen = new Set<string>();
          for (const addr of canonical) {
            if (seen.has(addr)) continue;
            seen.add(addr);
            uniq.push(addr);
          }

          const state: NamespaceAccountsState<string> = emptyNamespaceState<string>();
          state.all = uniq;
          state.primary =
            selectedAddress && ns === namespace && uniq.includes(selectedAddress) ? selectedAddress : (uniq[0] ?? null);
          return [ns, state];
        }),
      ) as Record<ChainNamespace, NamespaceAccountsState<T>>;

      const selectedAddressForNamespace = (selectedAddress as AccountAddress<T> | null) ?? null;
      const activeAddress =
        selectedAddressForNamespace && (namespaces[namespace]?.all ?? []).includes(selectedAddressForNamespace)
          ? selectedAddressForNamespace
          : ((namespaces[namespace]?.primary as string | null | undefined) ?? null);

      const activePointer: ActivePointer<T> = {
        namespace,
        chainRef: activeChain.chainRef,
        address: (activeAddress as AccountAddress<T> | null) ?? null,
      };

      const next: MultiNamespaceAccountsState<T> = {
        namespaces,
        active: activePointer.address ? activePointer : null,
      };

      const prev = this.#state;
      if (isSameState(prev, next)) {
        return;
      }

      this.#state = cloneState(next);

      for (const [ns, nsState] of Object.entries(next.namespaces)) {
        const prevNs = prev.namespaces[ns];
        if (!prevNs || !isSameNamespace(prevNs, nsState)) {
          this.#messenger.publish(
            TOPIC_NAMESPACE,
            { namespace: ns, state: cloneNamespace(nsState) } as NamespaceStateChange<T>,
            {
              force: true,
            },
          );
        }
      }

      if (!isSamePointer(prev.active, next.active)) {
        this.#messenger.publish(TOPIC_ACTIVE, clonePointer(next.active), { force: true });
      }

      this.#messenger.publish(TOPIC_STATE, cloneState(this.#state), { force: true });
    })().finally(() => {
      this.#refreshPromise = null;
    });

    await this.#refreshPromise;
  }
}
