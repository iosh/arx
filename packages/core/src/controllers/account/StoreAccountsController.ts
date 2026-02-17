import { toAccountIdFromAddress, toCanonicalAddressFromAccountId } from "../../accounts/accountId.js";
import type { ChainRef } from "../../chains/ids.js";
import { parseChainRef } from "../../chains/index.js";
import type { AccountId } from "../../db/records.js";
import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import type { AccountsService } from "../../services/accounts/types.js";
import type { SettingsService } from "../../services/settings/types.js";
import type { NetworkController } from "../network/types.js";
import type {
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
const TOPIC_SELECTED = "accounts:selectedChanged";

const emptyNamespaceState = (): NamespaceAccountsState => ({ accountIds: [], selectedAccountId: null });

const cloneNamespace = (state: NamespaceAccountsState): NamespaceAccountsState => ({
  accountIds: [...state.accountIds],
  selectedAccountId: state.selectedAccountId ?? null,
});

const cloneState = (state: MultiNamespaceAccountsState): MultiNamespaceAccountsState => {
  const namespaces = Object.fromEntries(
    Object.entries(state.namespaces).map(([ns, value]) => [ns, cloneNamespace(value as NamespaceAccountsState)]),
  ) as Record<ChainNamespace, NamespaceAccountsState>;
  return { namespaces };
};

const isSameNamespace = (prev?: NamespaceAccountsState, next?: NamespaceAccountsState) => {
  if (!prev || !next) return false;
  if ((prev.selectedAccountId ?? null) !== (next.selectedAccountId ?? null)) return false;
  if (prev.accountIds.length !== next.accountIds.length) return false;
  return prev.accountIds.every((value, index) => value === next.accountIds[index]);
};

const isSameState = (prev?: MultiNamespaceAccountsState, next?: MultiNamespaceAccountsState) => {
  if (!prev || !next) return false;
  const prevNamespaces = Object.keys(prev.namespaces);
  const nextNamespaces = Object.keys(next.namespaces);
  if (prevNamespaces.length !== nextNamespaces.length) return false;
  return prevNamespaces.every((ns) => isSameNamespace(prev.namespaces[ns], next.namespaces[ns]));
};

type Options = {
  messenger: ControllerMessenger<AccountMessengerTopics>;
  accounts: AccountsService;
  network: Pick<NetworkController, "getActiveChain" | "onChainChanged">;
  settings?: SettingsService | null;
  logger?: (message: string, error?: unknown) => void;
};

// Store-backed accounts controller: derives a read model from AccountsService + SettingsService.
export class StoreAccountsController implements AccountController {
  #messenger: ControllerMessenger<AccountMessengerTopics>;
  #accounts: AccountsService;
  #settings: SettingsService | null;
  #network: Pick<NetworkController, "getActiveChain" | "onChainChanged">;
  #logger?: ((message: string, error?: unknown) => void) | undefined;

  #state: MultiNamespaceAccountsState = { namespaces: {} };
  #selectedOverrideByNamespace: Record<string, AccountId | null> = {};
  #refreshPromise: Promise<void> | null = null;
  #subscriptions: Array<() => void> = [];
  #onAccountsChanged = () => void this.refresh();
  #onSettingsChanged = () => void this.refresh();

  constructor({ messenger, accounts, settings, network, logger }: Options) {
    this.#messenger = messenger;
    this.#accounts = accounts;
    this.#settings = settings ?? null;
    this.#network = network;
    this.#logger = logger;

    this.#subscriptions.push(
      this.#network.onChainChanged(() => {
        // Selection is per-namespace; some namespaces may derive canonical/display forms using chainRef.
        // Refresh is cheap (store read + compare) and keeps derived state in sync.
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

  getState(): MultiNamespaceAccountsState {
    return cloneState(this.#state);
  }

  getAccounts(params: { chainRef: ChainRef }): string[] {
    const { namespace } = parseChainRef(params.chainRef);
    const record = this.#state.namespaces[namespace];
    if (!record) return [];
    return record.accountIds.map((id) => toCanonicalAddressFromAccountId({ chainRef: params.chainRef, accountId: id }));
  }

  getAccountIdsForNamespace(namespace: ChainNamespace): AccountId[] {
    const record = this.#state.namespaces[namespace];
    return record ? [...record.accountIds] : [];
  }

  getSelectedAccountId(namespace: ChainNamespace): AccountId | null {
    const record = this.#state.namespaces[namespace];
    return record?.selectedAccountId ?? null;
  }

  getSelectedPointer(params: { chainRef: ChainRef }): ActivePointer | null {
    const { namespace } = parseChainRef(params.chainRef);
    const accountId = this.getSelectedAccountId(namespace);
    if (!accountId) return null;
    const address = toCanonicalAddressFromAccountId({ chainRef: params.chainRef, accountId });
    return { namespace, chainRef: params.chainRef, accountId, address };
  }

  getSelectedAddress(params: { chainRef: ChainRef }): string | null {
    return this.getSelectedPointer(params)?.address ?? null;
  }

  async switchActive(params: { chainRef: ChainRef; address?: string | null }): Promise<ActivePointer | null> {
    const chainRef = params.chainRef;
    const { namespace } = parseChainRef(chainRef);
    const address = params.address ?? null;

    let nextSelected: AccountId | null = null;
    if (address) {
      const candidate = toAccountIdFromAddress({ chainRef, address });
      const record = await this.#accounts.get(candidate);
      if (!record) {
        throw new Error(`Unknown account "${address}" for namespace "${namespace}"`);
      }
      if (record.hidden) {
        throw new Error(`Account "${address}" is hidden for namespace "${namespace}"`);
      }
      nextSelected = candidate;
    }

    if (this.#settings) {
      await this.#settings.upsert({
        selectedAccountIdsByNamespace: {
          [namespace]: nextSelected,
        },
      });
      delete this.#selectedOverrideByNamespace[namespace];
    } else {
      this.#selectedOverrideByNamespace[namespace] = nextSelected;
    }

    await this.refresh();
    return this.getSelectedPointer({ chainRef });
  }

  async requestAccounts({ origin: _origin, chainRef }: { origin: string; chainRef: ChainRef }): Promise<string[]> {
    return this.getAccounts({ chainRef });
  }

  onStateChanged(handler: (state: MultiNamespaceAccountsState) => void): () => void {
    return this.#messenger.subscribe(TOPIC_STATE, handler);
  }

  onNamespaceChanged(handler: (payload: NamespaceStateChange) => void): () => void {
    return this.#messenger.subscribe(TOPIC_NAMESPACE, handler);
  }

  onSelectedChanged(
    handler: (payload: { namespace: ChainNamespace; selectedAccountId: AccountId | null }) => void,
  ): () => void {
    return this.#messenger.subscribe(TOPIC_SELECTED, handler);
  }

  async refresh(): Promise<void> {
    if (this.#refreshPromise) return await this.#refreshPromise;

    this.#refreshPromise = (async () => {
      const records = await this.#accounts.list({ includeHidden: false });
      const sorted = [...records].sort((a, b) => a.createdAt - b.createdAt || a.accountId.localeCompare(b.accountId));

      const byNamespace = new Map<string, AccountId[]>();
      for (const record of sorted) {
        const list = byNamespace.get(record.namespace) ?? [];
        list.push(record.accountId);
        byNamespace.set(record.namespace, list);
      }

      let selectedByNamespace: Record<string, AccountId> = {};
      if (this.#settings) {
        try {
          const settings = await this.#settings.get();
          selectedByNamespace = { ...(settings?.selectedAccountIdsByNamespace ?? {}) };
        } catch (error) {
          this.#logger?.("accounts: failed to load settings", error);
          // Ignore and fallback to overrides below.
          selectedByNamespace = {};
        }
      }

      for (const [namespace, override] of Object.entries(this.#selectedOverrideByNamespace)) {
        if (!override) continue;
        selectedByNamespace[namespace] = override;
      }

      const nextNamespaces: Record<ChainNamespace, NamespaceAccountsState> = {};
      for (const [ns, accountIds] of byNamespace.entries()) {
        const desired = selectedByNamespace[ns] ?? null;
        nextNamespaces[ns] = {
          accountIds: [...accountIds],
          selectedAccountId: desired && accountIds.includes(desired) ? desired : (accountIds[0] ?? null),
        };
      }

      const next: MultiNamespaceAccountsState = { namespaces: nextNamespaces };
      const prev = this.#state;
      if (isSameState(prev, next)) return;

      this.#state = cloneState(next);

      // Per-namespace change events (including removals).
      const prevKeys = new Set(Object.keys(prev.namespaces));
      const nextKeys = new Set(Object.keys(next.namespaces));
      const allKeys = new Set<string>([...prevKeys, ...nextKeys]);

      for (const ns of allKeys) {
        const prevNs = prev.namespaces[ns];
        const nextNs = next.namespaces[ns] ?? emptyNamespaceState();
        if (!prevNs || !isSameNamespace(prevNs, nextNs)) {
          this.#messenger.publish(
            TOPIC_NAMESPACE,
            { namespace: ns, state: cloneNamespace(nextNs) } as NamespaceStateChange,
            { force: true },
          );
        }

        const prevSelected = prevNs?.selectedAccountId ?? null;
        const nextSelected = nextNs.selectedAccountId ?? null;
        if (prevSelected !== nextSelected) {
          this.#messenger.publish(TOPIC_SELECTED, { namespace: ns, selectedAccountId: nextSelected }, { force: true });
        }
      }

      this.#messenger.publish(TOPIC_STATE, cloneState(this.#state), { force: true });
    })().finally(() => {
      this.#refreshPromise = null;
    });

    await this.#refreshPromise;
  }
}
