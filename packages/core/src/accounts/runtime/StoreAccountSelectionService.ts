import {
  canonicalChainAddressFromAccountId,
  displayChainAddressFromAccountId,
  getAccountIdNamespace,
} from "../../accounts/addressing/accountId.js";
import type { AccountAddressingByNamespace } from "../../accounts/addressing/addressing.js";
import { parseChainRef } from "../../chains/caip.js";
import type { Messenger } from "../../messenger/index.js";
import { RpcInvalidRequestError } from "../../rpc/errors.js";
import type { AccountsService } from "../../accounts/accountsTypes.js";
import type { AccountId } from "../../storage/records.js";
import { cloneMultiNamespaceAccountsState, isSameMultiNamespaceAccountsState } from "./state.js";
import { ACCOUNTS_STATE_CHANGED } from "./topics.js";
import type {
  AccountSelectionService,
  ActiveAccountView,
  ChainNamespace,
  MultiNamespaceAccountsState,
  NamespaceChainContext,
  OwnedAccountView,
} from "./types.js";

type Options = {
  messenger: Messenger;
  accounts: AccountsService;
  accountAddressing: AccountAddressingByNamespace;
};

export class StoreAccountSelectionService implements AccountSelectionService {
  #messenger: Messenger;
  #accounts: AccountsService;
  #accountAddressing: AccountAddressingByNamespace;

  #state: MultiNamespaceAccountsState = { namespaces: {} };
  #ready: Promise<void>;
  #refreshPromise: Promise<void> | null = null;
  #unsubscribeAccounts: (() => void) | null = null;

  constructor({ messenger, accounts, accountAddressing }: Options) {
    this.#messenger = messenger;
    this.#accounts = accounts;
    this.#accountAddressing = accountAddressing;

    this.#unsubscribeAccounts = this.#accounts.subscribeChanged(() => {
      void this.refresh();
    });

    this.#ready = this.refresh();
  }

  whenReady(): Promise<void> {
    return this.#ready;
  }

  destroy() {
    if (this.#unsubscribeAccounts) {
      const unsubscribeAccounts = this.#unsubscribeAccounts;
      this.#unsubscribeAccounts = null;
      unsubscribeAccounts();
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

    await this.#accounts.setSelectedAccountId({ namespace, accountId });

    await this.refresh();
    return this.getActiveAccountForNamespace({ namespace, chainRef });
  }

  onStateChanged(handler: (state: MultiNamespaceAccountsState) => void): () => void {
    return this.#messenger.subscribe(ACCOUNTS_STATE_CHANGED, handler);
  }

  #assertNamespaceChainContext(params: NamespaceChainContext): NamespaceChainContext {
    const parsed = parseChainRef(params.chainRef);
    if (parsed.namespace !== params.namespace) {
      throw new RpcInvalidRequestError({
        message: `Account namespace mismatch: chainRef "${params.chainRef}" belongs to namespace "${parsed.namespace}" but "${params.namespace}" was provided`,
        details: { chainRef: params.chainRef, namespace: params.namespace, expectedNamespace: parsed.namespace },
      });
    }

    return params;
  }

  #toOwnedAccountView(params: {
    namespace: ChainNamespace;
    chainRef: NamespaceChainContext["chainRef"];
    accountId: AccountId;
  }): OwnedAccountView {
    return {
      accountId: params.accountId,
      namespace: params.namespace,
      canonicalAddress: canonicalChainAddressFromAccountId({
        accountAddressing: this.#accountAddressing,
        chainRef: params.chainRef,
        accountId: params.accountId,
      }),
      displayAddress: displayChainAddressFromAccountId({
        accountAddressing: this.#accountAddressing,
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
        const namespace = getAccountIdNamespace(record.accountId);
        const list = byNamespace.get(namespace) ?? [];
        list.push(record.accountId);
        byNamespace.set(namespace, list);
      }

      const selectedByNamespace = await this.#accounts.getSelectedAccountIdsByNamespace();

      const nextNamespaces: MultiNamespaceAccountsState["namespaces"] = {};
      const namespaces = [...byNamespace.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      for (const [ns, accountIds] of namespaces) {
        const [defaultAccountId, ...remainingAccountIds] = accountIds;
        if (!defaultAccountId) continue;

        const desired = selectedByNamespace[ns];
        const selectedAccountId = desired && accountIds.includes(desired) ? desired : defaultAccountId;
        nextNamespaces[ns] = {
          accountIds: [defaultAccountId, ...remainingAccountIds],
          selectedAccountId,
        };
      }

      const next: MultiNamespaceAccountsState = { namespaces: nextNamespaces };
      const prev = this.#state;
      if (isSameMultiNamespaceAccountsState(prev, next)) return;

      this.#state = cloneMultiNamespaceAccountsState(next);
      this.#messenger.publish(ACCOUNTS_STATE_CHANGED, cloneMultiNamespaceAccountsState(this.#state));
    })().finally(() => {
      this.#refreshPromise = null;
    });

    await this.#refreshPromise;
  }
}
