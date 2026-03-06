import { ArxReasons, arxError } from "@arx/errors";
import { toAccountIdFromAddress, toCanonicalAddressFromAccountId } from "../../accounts/addressing/accountId.js";
import { parseChainRef } from "../../chains/caip.js";
import type { ChainRef } from "../../chains/ids.js";
import type { AccountsService } from "../../services/store/accounts/types.js";
import type { SettingsService } from "../../services/store/settings/types.js";
import type { AccountId } from "../../storage/records.js";
import { cloneMultiNamespaceAccountsState, isSameMultiNamespaceAccountsState } from "./state.js";
import { ACCOUNTS_STATE_CHANGED, type AccountMessenger } from "./topics.js";
import type {
  AccountController,
  ActivePointer,
  ChainNamespace,
  MultiNamespaceAccountsState,
  NamespaceAccountsState,
  NamespaceChainContext,
} from "./types.js";

type Options = {
  messenger: AccountMessenger;
  accounts: AccountsService;
  settings: SettingsService;
  logger?: (message: string, error?: unknown) => void;
};

// Store-backed accounts controller: derives a read model from AccountsService + SettingsService.
export class StoreAccountsController implements AccountController {
  #messenger: AccountMessenger;
  #accounts: AccountsService;
  #settings: SettingsService;
  #logger?: ((message: string, error?: unknown) => void) | undefined;

  #state: MultiNamespaceAccountsState = { namespaces: {} };
  #refreshPromise: Promise<void> | null = null;
  #onAccountsChanged = () => void this.refresh();
  #onSettingsChanged = () => void this.refresh();
  #unsubscribeAccounts: (() => void) | null = null;
  #unsubscribeSettings: (() => void) | null = null;

  constructor({ messenger, accounts, settings, logger }: Options) {
    this.#messenger = messenger;
    this.#accounts = accounts;
    this.#settings = settings;
    this.#logger = logger;

    this.#unsubscribeAccounts = this.#accounts.subscribeChanged(() => this.#onAccountsChanged());
    this.#unsubscribeSettings = this.#settings.subscribeChanged(() => this.#onSettingsChanged());

    void this.refresh();
  }

  destroy() {
    if (this.#unsubscribeAccounts) {
      try {
        this.#unsubscribeAccounts();
      } catch (error) {
        this.#logger?.("accounts: failed to remove accounts store listener", error);
      } finally {
        this.#unsubscribeAccounts = null;
      }
    }
    if (this.#unsubscribeSettings) {
      try {
        this.#unsubscribeSettings();
      } catch (error) {
        this.#logger?.("accounts: failed to remove settings listener", error);
      } finally {
        this.#unsubscribeSettings = null;
      }
    }
  }

  getState(): MultiNamespaceAccountsState {
    return cloneMultiNamespaceAccountsState(this.#state);
  }

  getAccountsForNamespace(params: NamespaceChainContext): string[] {
    const { namespace, chainRef } = this.#assertNamespaceChainContext(params);
    const record = this.#state.namespaces[namespace];
    if (!record) return [];
    return record.accountIds.map((id) => toCanonicalAddressFromAccountId({ chainRef, accountId: id }));
  }

  getAccountIdsForNamespace(namespace: ChainNamespace): AccountId[] {
    const record = this.#state.namespaces[namespace];
    return record ? [...record.accountIds] : [];
  }

  getSelectedAccountId(namespace: ChainNamespace): AccountId | null {
    const record = this.#state.namespaces[namespace];
    return record?.selectedAccountId ?? null;
  }

  getSelectedPointerForNamespace(params: NamespaceChainContext): ActivePointer | null {
    const { namespace, chainRef } = this.#assertNamespaceChainContext(params);
    const accountId = this.getSelectedAccountId(namespace);
    if (!accountId) return null;
    const address = toCanonicalAddressFromAccountId({ chainRef, accountId });
    return { namespace, chainRef, accountId, address };
  }

  getSelectedAddressForNamespace(params: NamespaceChainContext): string | null {
    return this.getSelectedPointerForNamespace(params)?.address ?? null;
  }

  async switchActiveForNamespace(
    params: NamespaceChainContext & { address?: string | null },
  ): Promise<ActivePointer | null> {
    const { namespace, chainRef } = this.#assertNamespaceChainContext(params);
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

    await this.#settings.update({
      selectedAccountIdsByNamespace: {
        [namespace]: nextSelected,
      },
    });

    await this.refresh();
    return this.getSelectedPointerForNamespace({ namespace, chainRef });
  }

  async requestAccounts({ chainRef }: { chainRef: ChainRef }): Promise<string[]> {
    const { namespace } = parseChainRef(chainRef);
    return this.getAccountsForNamespace({ namespace, chainRef });
  }

  onStateChanged(handler: (state: MultiNamespaceAccountsState) => void): () => void {
    return this.#messenger.subscribe(ACCOUNTS_STATE_CHANGED, handler, { replay: "snapshot" });
  }

  #assertNamespaceChainContext(params: NamespaceChainContext): NamespaceChainContext {
    const parsed = parseChainRef(params.chainRef);
    if (parsed.namespace !== params.namespace) {
      throw new Error(
        `Account namespace mismatch: chainRef "${params.chainRef}" belongs to namespace "${parsed.namespace}" but "${params.namespace}" was provided`,
      );
    }

    return params;
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

      // Stabilize ordering to avoid state jitter when the storage layer returns nondeterministic lists.
      for (const [ns, list] of byNamespace.entries()) {
        const sorted = [...list].sort((a, b) => String(a).localeCompare(String(b)));
        byNamespace.set(ns, sorted);
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
      const namespaces = [...byNamespace.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      for (const [ns, accountIds] of namespaces) {
        const desired = selectedByNamespace[ns] ?? null;
        nextNamespaces[ns] = {
          accountIds: [...accountIds],
          selectedAccountId: desired && accountIds.includes(desired) ? desired : (accountIds[0] ?? null),
        };
      }

      const next: MultiNamespaceAccountsState = { namespaces: nextNamespaces };
      const prev = this.#state;
      if (isSameMultiNamespaceAccountsState(prev, next)) return;

      this.#state = cloneMultiNamespaceAccountsState(next);

      this.#messenger.publish(ACCOUNTS_STATE_CHANGED, cloneMultiNamespaceAccountsState(this.#state), { force: true });
    })().finally(() => {
      this.#refreshPromise = null;
    });

    await this.#refreshPromise;
  }
}
