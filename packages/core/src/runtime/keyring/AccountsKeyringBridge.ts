import type { ChainRef } from "../../chains/ids.js";
import { parseChainRef } from "../../chains/index.js";
import type { AccountController, NamespaceAccountsState } from "../../controllers/account/types.js";
import type { KeyringAccount } from "../../keyring/types.js";
import type { KeyringService } from "./KeyringService.js";

type AccountsPort = Pick<AccountController, "switchActive" | "getState" | "getActivePointer">;

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
  namespaceState: NamespaceAccountsState<string>;
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

    const namespaceState = this.#computeNamespaceStateAfterUpsert(
      options.namespace,
      account.address,
      options.makePrimary,
    );
    await this.#maybeSwitchActive(options, account.address, namespaceState);
    return { account, namespaceState };
  }

  async importAccount(options: ImportAccountOptions): Promise<BridgeAccountResult> {
    this.#assertNamespace(options.namespace, options.chainRef);
    const { account } = await this.#keyring.importPrivateKey(options.privateKey, {
      namespace: options.namespace,
    });
    let namespaceState: NamespaceAccountsState<string> | null = null;

    try {
      namespaceState = this.#computeNamespaceStateAfterUpsert(options.namespace, account.address, options.makePrimary);
      await this.#maybeSwitchActive(options, account.address, namespaceState);
      return { account, namespaceState };
    } catch (error) {
      this.#logger?.("bridge: importAccount failed after keyring write", error);

      throw error;
    }
  }

  async removeAccount(options: RemoveAccountOptions): Promise<NamespaceAccountsState<string>> {
    this.#assertNamespace(options.namespace, options.chainRef);

    const before = this.#accounts.getState().namespaces[options.namespace] ?? { all: [], primary: null };

    await this.#keyring.removeAccount(options.namespace, options.address);

    const normalize = (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return "";
      return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`).toLowerCase();
    };

    const target = normalize(options.address);
    const all = before.all.filter((a) => normalize(a) !== target);
    const primary =
      before.primary && normalize(before.primary) === target ? (all[0] ?? null) : (before.primary ?? null);

    return { all, primary };
  }

  async setPrimaryAccount(options: SetPrimaryOptions): Promise<NamespaceAccountsState<string>> {
    this.#assertNamespace(options.namespace, options.chainRef);

    if (!this.#keyring.hasAccount(options.namespace, options.address)) {
      throw new Error(`Address ${options.address} is not managed by namespace "${options.namespace}"`);
    }

    const namespaceState = this.#computeNamespaceStateAfterUpsert(options.namespace, options.address, true);
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

  async #maybeSwitchActive(
    options: DeriveAccountOptions,
    address: string,
    namespaceState: NamespaceAccountsState<string>,
  ): Promise<void> {
    const shouldSwitch = options.switchActive ?? namespaceState.primary === address;
    if (!shouldSwitch) return;
    await this.#accounts.switchActive({ chainRef: options.chainRef, address });
  }

  #computeNamespaceStateAfterUpsert(namespace: string, address: string, makePrimary?: boolean) {
    const state = this.#accounts.getState();
    const current = state.namespaces[namespace] ?? { all: [], primary: null };
    const all = current.all.includes(address) ? [...current.all] : [...current.all, address];
    const primary = makePrimary === true ? address : (current.primary ?? (all.length > 0 ? all[0]! : null));
    return { all, primary };
  }

  #pickDefaultHdKeyringId(): string {
    const meta = this.#keyring.getKeyrings().find((m) => m.type === "hd");
    if (!meta) throw new Error("No HD keyring available");
    return meta.id;
  }
}
