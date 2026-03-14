import { ArxReasons, arxError } from "@arx/errors";
import { getAccountIdNamespace } from "../../accounts/addressing/accountId.js";
import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import { parseChainRef } from "../../chains/caip.js";
import type { AccountsService } from "../../services/store/accounts/types.js";
import type { SettingsService } from "../../services/store/settings/types.js";
import type { AccountId } from "../../storage/records.js";
import { cloneMultiNamespaceAccountsState, isSameMultiNamespaceAccountsState } from "./state.js";
import { ACCOUNTS_STATE_CHANGED, type AccountMessenger } from "./topics.js";
import type {
  AccountController,
  ActiveAccountView,
  ChainNamespace,
  MultiNamespaceAccountsState,
  NamespaceAccountsState,
  NamespaceChainContext,
  OwnedAccountView,
} from "./types.js";

type Options = {
  messenger: AccountMessenger;
  accounts: AccountsService;
  settings: SettingsService;
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountId" | "toDisplayAddressFromAccountId">;
  logger?: (message: string, error?: unknown) => void;
};

export class StoreAccountsController implements AccountController {
  #messenger: AccountMessenger;
  #accounts: AccountsService;
  #settings: SettingsService;
  #accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountId" | "toDisplayAddressFromAccountId">;
  #logger?: ((message: string, error?: unknown) => void) | undefined;

  #state: MultiNamespaceAccountsState = { namespaces: {} };
  #ready: Promise<void>;
  #refreshPromise: Promise<void> | null = null;
  #unsubscribeAccounts: (() => void) | null = null;
  #unsubscribeSettings: (() => void) | null = null;

  constructor({ messenger, accounts, settings, accountCodecs, logger }: Options) {
    this.#messenger = messenger;
    this.#accounts = accounts;
    this.#settings = settings;
    this.#accountCodecs = accountCodecs;
    this.#logger = logger;

    this.#unsubscribeAccounts = this.#accounts.subscribeChanged(() => {
      void this.refresh();
    });
    this.#unsubscribeSettings = this.#settings.subscribeChanged(() => {
      void this.refresh();
    });

    this.#ready = this.refresh();
  }

  whenReady(): Promise<void> {
    return this.#ready;
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

  listOwnedForNamespace(params: NamespaceChainContext): OwnedAccountView[] {
    const { namespace, chainRef } = this.#assertNamespaceChainContext(params);
    const record = this.#state.namespaces[namespace];
    if (!record) return [];
    return record.accountIds.map((accountId) => this.#toOwnedAccountView({ namespace, chainRef, accountId }));
  }

  getOwnedAccount(params: NamespaceChainContext & { accountId: AccountId }): OwnedAccountView | null {
    const { namespace, chainRef } = this.#assertNamespaceChainContext(params);
    const { accountId } = params;
    const record = this.#state.namespaces[namespace];
    if (!record?.accountIds.includes(accountId)) return null;
    return this.#toOwnedAccountView({ namespace, chainRef, accountId });
  }

  getAccountIdsForNamespace(namespace: ChainNamespace): AccountId[] {
    const record = this.#state.namespaces[namespace];
    return record ? [...record.accountIds] : [];
  }

  getSelectedAccountId(namespace: ChainNamespace): AccountId | null {
    const record = this.#state.namespaces[namespace];
    return record?.selectedAccountId ?? null;
  }

  getActiveAccountForNamespace(params: NamespaceChainContext): ActiveAccountView | null {
    const { namespace, chainRef } = this.#assertNamespaceChainContext(params);
    const accountId = this.getSelectedAccountId(namespace);
    if (!accountId) return null;

    const owned = this.getOwnedAccount({ namespace, chainRef, accountId });
    if (!owned) return null;

    return {
      ...owned,
      chainRef,
    };
  }

  async setActiveAccount(
    params: NamespaceChainContext & { accountId?: AccountId | null },
  ): Promise<ActiveAccountView | null> {
    const { namespace, chainRef } = this.#assertNamespaceChainContext(params);
    const accountId = params.accountId ?? null;

    if (accountId !== null) {
      this.#assertAccountIdNamespace(accountId, namespace);

      const record = await this.#accounts.get(accountId);
      if (!record) {
        throw arxError({
          reason: ArxReasons.KeyringAccountNotFound,
          message: `Unknown account "${accountId}" for namespace "${namespace}"`,
          data: { chainRef, namespace, accountId },
        });
      }
      if (record.hidden) {
        throw arxError({
          reason: ArxReasons.PermissionDenied,
          message: `Account "${accountId}" is hidden for namespace "${namespace}"`,
          data: { chainRef, namespace, accountId },
        });
      }
    }

    await this.#settings.update({
      selectedAccountIdsByNamespace: {
        [namespace]: accountId,
      },
    });

    await this.refresh();
    return this.getActiveAccountForNamespace({ namespace, chainRef });
  }

  onStateChanged(handler: (state: MultiNamespaceAccountsState) => void): () => void {
    return this.#messenger.subscribe(ACCOUNTS_STATE_CHANGED, handler, { replay: "snapshot" });
  }

  #assertNamespaceChainContext(params: NamespaceChainContext): NamespaceChainContext {
    const parsed = parseChainRef(params.chainRef);
    if (parsed.namespace !== params.namespace) {
      throw arxError({
        reason: ArxReasons.RpcInvalidRequest,
        message: `Account namespace mismatch: chainRef "${params.chainRef}" belongs to namespace "${parsed.namespace}" but "${params.namespace}" was provided`,
        data: { chainRef: params.chainRef, namespace: params.namespace, expectedNamespace: parsed.namespace },
      });
    }

    return params;
  }

  #assertAccountIdNamespace(accountId: AccountId, namespace: ChainNamespace): void {
    const accountNamespace = getAccountIdNamespace(accountId);
    if (accountNamespace !== namespace) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: `Account "${accountId}" does not belong to namespace "${namespace}"`,
        data: { accountId, namespace, accountNamespace },
      });
    }
  }

  #toOwnedAccountView(params: {
    namespace: ChainNamespace;
    chainRef: NamespaceChainContext["chainRef"];
    accountId: AccountId;
  }): OwnedAccountView {
    return {
      accountId: params.accountId,
      namespace: params.namespace,
      canonicalAddress: this.#accountCodecs.toCanonicalAddressFromAccountId({ accountId: params.accountId }),
      displayAddress: this.#accountCodecs.toDisplayAddressFromAccountId({
        chainRef: params.chainRef,
        accountId: params.accountId,
      }),
    };
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
