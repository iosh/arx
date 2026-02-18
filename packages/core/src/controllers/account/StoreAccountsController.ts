import { ArxReasons, arxError } from "@arx/errors";
import { toAccountIdFromAddress, toCanonicalAddressFromAccountId } from "../../accounts/accountId.js";
import type { ChainRef } from "../../chains/ids.js";
import { parseChainRef } from "../../chains/index.js";
import type { AccountId } from "../../db/records.js";
import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import type { AccountsService } from "../../services/accounts/types.js";
import type { SettingsService } from "../../services/settings/types.js";
import type {
  AccountController,
  AccountMessengerTopics,
  ActivePointer,
  ChainNamespace,
  MultiNamespaceAccountsState,
  NamespaceAccountsState,
} from "./types.js";

const TOPIC_STATE = "accounts:stateChanged";

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
  settings: SettingsService;
  logger?: (message: string, error?: unknown) => void;
};

// Store-backed accounts controller: derives a read model from AccountsService + SettingsService.
export class StoreAccountsController implements AccountController {
  #messenger: ControllerMessenger<AccountMessengerTopics>;
  #accounts: AccountsService;
  #settings: SettingsService;
  #logger?: ((message: string, error?: unknown) => void) | undefined;

  #state: MultiNamespaceAccountsState = { namespaces: {} };
  #refreshPromise: Promise<void> | null = null;
  #onAccountsChanged = () => void this.refresh();
  #onSettingsChanged = () => void this.refresh();

  constructor({ messenger, accounts, settings, logger }: Options) {
    this.#messenger = messenger;
    this.#accounts = accounts;
    this.#settings = settings;
    this.#logger = logger;

    this.#accounts.on("changed", this.#onAccountsChanged);
    this.#settings.on("changed", this.#onSettingsChanged);

    void this.refresh();
  }

  destroy() {
    try {
      this.#accounts.off("changed", this.#onAccountsChanged);
    } catch (error) {
      this.#logger?.("accounts: failed to remove accounts store listener", error);
    }
    try {
      this.#settings.off("changed", this.#onSettingsChanged);
    } catch (error) {
      this.#logger?.("accounts: failed to remove settings listener", error);
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
      let candidate: AccountId;
      try {
        candidate = toAccountIdFromAddress({ chainRef, address });
      } catch (error) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: `Invalid address "${address}"`,
          data: { chainRef, namespace, address },
          cause: error,
        });
      }
      const record = await this.#accounts.get(candidate);
      if (!record) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: `Unknown account "${address}" for namespace "${namespace}"`,
          data: { chainRef, namespace, address },
        });
      }
      if (record.hidden) {
        throw arxError({
          reason: ArxReasons.RpcInvalidParams,
          message: `Account "${address}" is hidden for namespace "${namespace}"`,
          data: { chainRef, namespace, address },
        });
      }
      nextSelected = candidate;
    }

    await this.#settings.upsert({
      selectedAccountIdsByNamespace: {
        [namespace]: nextSelected,
      },
    });

    await this.refresh();
    return this.getSelectedPointer({ chainRef });
  }

  async requestAccounts({ chainRef }: { chainRef: ChainRef }): Promise<string[]> {
    return this.getAccounts({ chainRef });
  }

  onStateChanged(handler: (state: MultiNamespaceAccountsState) => void): () => void {
    return this.#messenger.subscribe(TOPIC_STATE, handler);
  }

  async refresh(): Promise<void> {
    if (this.#refreshPromise) return await this.#refreshPromise;

    this.#refreshPromise = (async () => {
      const records = await this.#accounts.list({ includeHidden: false });
      const byNamespace = new Map<string, AccountId[]>();
      for (const record of records) {
        const list = byNamespace.get(record.namespace) ?? [];
        list.push(record.accountId);
        byNamespace.set(record.namespace, list);
      }

      let selectedByNamespace: Record<string, AccountId> = {};
      try {
        const settings = await this.#settings.get();
        selectedByNamespace = { ...(settings?.selectedAccountIdsByNamespace ?? {}) };
      } catch (error) {
        this.#logger?.("accounts: failed to load settings", error);
        selectedByNamespace = {};
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

      this.#messenger.publish(TOPIC_STATE, cloneState(this.#state), { force: true });
    })().finally(() => {
      this.#refreshPromise = null;
    });

    await this.#refreshPromise;
  }
}
