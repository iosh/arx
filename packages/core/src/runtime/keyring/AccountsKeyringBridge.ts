import { toAccountIdFromAddress } from "../../accounts/accountId.js";
import type { ChainRef } from "../../chains/ids.js";
import { parseChainRef } from "../../chains/index.js";
import type { AccountController, NamespaceAccountsState } from "../../controllers/account/types.js";
import type { AccountId } from "../../db/records.js";
import type { KeyringAccount } from "../../keyring/types.js";
import type { KeyringService } from "./KeyringService.js";

type AccountsPort = Pick<AccountController, "switchActive" | "getState">;

type BridgeOptions = {
  keyring: KeyringService;
  accounts: AccountsPort;
  logger?: (message: string, error?: unknown) => void;
};

type DeriveAccountOptions = {
  namespace: string;
  chainRef: ChainRef;
  keyringId?: string;
  makePrimary?: boolean;
  switchActive?: boolean;
};

type ImportAccountOptions = DeriveAccountOptions & {
  privateKey: string | Uint8Array;
};

type RemoveAccountOptions = {
  namespace: string;
  chainRef: ChainRef;
  address: string;
};

type SetPrimaryOptions = {
  namespace: string;
  chainRef: ChainRef;
  address: string;
};

export type BridgeAccountResult = {
  account: KeyringAccount<string>;
  namespaceState: NamespaceAccountsState;
};

const toAccountId = (params: { namespace: string; chainRef: ChainRef; address: string }): AccountId => {
  return toAccountIdFromAddress({ chainRef: params.chainRef, address: params.address });
};

export class AccountsKeyringBridge {
  #keyring: KeyringService;
  #accounts: AccountsPort;
  #logger?: ((message: string, error?: unknown) => void) | undefined;

  constructor(options: BridgeOptions) {
    this.#keyring = options.keyring;
    this.#accounts = options.accounts;
    this.#logger = options.logger;
  }

  async deriveAccount(options: DeriveAccountOptions): Promise<BridgeAccountResult> {
    this.#assertNamespace(options.namespace, options.chainRef);
    const keyringId = options.keyringId ?? this.#pickDefaultHdKeyringId();
    const account = await this.#keyring.deriveAccount(keyringId);

    const namespaceState = this.#computeNamespaceStateAfterUpsert(options, account.address);
    await this.#maybeSwitchActive(options, account.address, namespaceState);
    return { account, namespaceState };
  }

  async importAccount(options: ImportAccountOptions): Promise<BridgeAccountResult> {
    this.#assertNamespace(options.namespace, options.chainRef);
    const { account } = await this.#keyring.importPrivateKey(options.privateKey, { namespace: options.namespace });

    let namespaceState: NamespaceAccountsState | null = null;
    try {
      namespaceState = this.#computeNamespaceStateAfterUpsert(options, account.address);
      await this.#maybeSwitchActive(options, account.address, namespaceState);
      return { account, namespaceState };
    } catch (error) {
      this.#logger?.("bridge: importAccount failed after keyring write", error);
      throw error;
    }
  }

  async removeAccount(options: RemoveAccountOptions): Promise<NamespaceAccountsState> {
    this.#assertNamespace(options.namespace, options.chainRef);
    const before = this.#accounts.getState().namespaces[options.namespace] ?? {
      accountIds: [],
      selectedAccountId: null,
    };

    await this.#keyring.removeAccount(options.namespace, options.address);

    const removedId = toAccountId({
      namespace: options.namespace,
      chainRef: options.chainRef,
      address: options.address,
    });

    const accountIds = before.accountIds.filter((id) => id !== removedId);
    const selectedAccountId =
      before.selectedAccountId === removedId ? (accountIds[0] ?? null) : (before.selectedAccountId ?? null);

    return { accountIds, selectedAccountId };
  }

  async setPrimaryAccount(options: SetPrimaryOptions): Promise<NamespaceAccountsState> {
    this.#assertNamespace(options.namespace, options.chainRef);

    if (!this.#keyring.hasAccount(options.namespace, options.address)) {
      throw new Error(`Address ${options.address} is not managed by namespace "${options.namespace}"`);
    }

    const namespaceState = this.#computeNamespaceStateAfterUpsert({ ...options, makePrimary: true }, options.address);
    await this.#accounts.switchActive({ chainRef: options.chainRef, address: options.address });
    return namespaceState;
  }

  #assertNamespace(namespace: string, chainRef: ChainRef): void {
    if (!this.#keyring.hasNamespace(namespace)) {
      throw new Error(`Namespace "${namespace}" is not initialized in the keyring`);
    }
    const { namespace: parsedNamespace } = parseChainRef(chainRef);
    if (parsedNamespace !== namespace) {
      throw new Error(`Chain ${chainRef} does not belong to namespace "${namespace}"`);
    }
  }

  #computeNamespaceStateAfterUpsert(
    options: { namespace: string; chainRef: ChainRef; makePrimary?: boolean },
    address: string,
  ) {
    const state = this.#accounts.getState();
    const current = state.namespaces[options.namespace] ?? { accountIds: [], selectedAccountId: null };

    const accountId = toAccountId({ namespace: options.namespace, chainRef: options.chainRef, address });
    const accountIds = current.accountIds.includes(accountId)
      ? [...current.accountIds]
      : [...current.accountIds, accountId];

    const selectedAccountId =
      options.makePrimary === true ? accountId : (current.selectedAccountId ?? accountIds[0] ?? null);

    return { accountIds, selectedAccountId };
  }

  async #maybeSwitchActive(
    options: DeriveAccountOptions,
    address: string,
    namespaceState: NamespaceAccountsState,
  ): Promise<void> {
    const accountId = toAccountId({ namespace: options.namespace, chainRef: options.chainRef, address });
    const shouldSwitch = options.switchActive ?? namespaceState.selectedAccountId === accountId;
    if (!shouldSwitch) return;
    await this.#accounts.switchActive({ chainRef: options.chainRef, address });
  }

  #pickDefaultHdKeyringId(): string {
    const meta = this.#keyring.getKeyrings().find((m) => m.type === "hd");
    if (!meta) throw new Error("No HD keyring available");
    return meta.id;
  }
}
