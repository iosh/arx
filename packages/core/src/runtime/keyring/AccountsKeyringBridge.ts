import type { Caip2ChainId } from "../../chains/ids.js";
import { parseCaip2 } from "../../chains/index.js";
import type { AccountController, NamespaceAccountsState } from "../../controllers/account/types.js";
import type { KeyringAccount } from "../../keyring/types.js";
import type { KeyringService } from "./KeyringService.js";

type AccountsPort = Pick<
  AccountController,
  "addAccount" | "removeAccount" | "switchActive" | "getState" | "getActivePointer"
>;

type BridgeOptions = {
  keyring: KeyringService;
  accounts: AccountsPort;
  logger?: (message: string, error?: unknown) => void;
};

type DeriveAccountOptions = {
  namespace: string;
  chainRef: Caip2ChainId;
  makePrimary?: boolean;
  switchActive?: boolean;
};

type ImportAccountOptions = DeriveAccountOptions & {
  privateKey: string | Uint8Array;
};

type RemoveAccountOptions = {
  namespace: string;
  chainRef: Caip2ChainId;
  address: string;
};

type SetPrimaryOptions = {
  namespace: string;
  chainRef: Caip2ChainId;
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
    const account = this.#keyring.deriveNextAccount(options.namespace);

    let namespaceState: NamespaceAccountsState<string> | null = null;

    try {
      namespaceState = await this.#accounts.addAccount({
        chainRef: options.chainRef,
        address: account.address,
        ...(options.makePrimary !== undefined ? { makePrimary: options.makePrimary } : {}),
      });

      await this.#maybeSwitchActive(options, account.address, namespaceState);
      return { account, namespaceState };
    } catch (error) {
      await this.#rollbackAccountAddition(options, account.address, namespaceState);
      throw error;
    }
  }

  async importAccount(options: ImportAccountOptions): Promise<BridgeAccountResult> {
    this.#assertNamespace(options.namespace, options.chainRef);
    const account = this.#keyring.importAccount(options.namespace, options.privateKey);

    let namespaceState: NamespaceAccountsState<string> | null = null;

    try {
      namespaceState = await this.#accounts.addAccount({
        chainRef: options.chainRef,
        address: account.address,
        ...(options.makePrimary !== undefined ? { makePrimary: options.makePrimary } : {}),
      });

      await this.#maybeSwitchActive(options, account.address, namespaceState);
      return { account, namespaceState };
    } catch (error) {
      await this.#rollbackAccountAddition(options, account.address, namespaceState);
      throw error;
    }
  }

  async removeAccount(options: RemoveAccountOptions): Promise<NamespaceAccountsState<string>> {
    this.#assertNamespace(options.namespace, options.chainRef);

    const snapshot = this.#accounts.getState();
    const previousNamespace = snapshot.namespaces[options.namespace];
    const previousPointer = this.#accounts.getActivePointer();

    const namespaceState = await this.#accounts.removeAccount({
      chainRef: options.chainRef,
      address: options.address,
    });

    try {
      this.#keyring.removeAccount(options.namespace, options.address);
    } catch (error) {
      this.#logger?.("bridge: failed to remove account from keyring", error);
      await this.#restoreAccountAfterKeyringFailure(options, previousNamespace, previousPointer);
      throw error;
    }

    return namespaceState;
  }

  async setPrimaryAccount(options: SetPrimaryOptions): Promise<NamespaceAccountsState<string>> {
    this.#assertNamespace(options.namespace, options.chainRef);

    if (!this.#keyring.hasAccount(options.namespace, options.address)) {
      throw new Error(`Address ${options.address} is not managed by namespace "${options.namespace}"`);
    }

    const namespaceState = await this.#accounts.addAccount({
      chainRef: options.chainRef,
      address: options.address,
      makePrimary: true,
    });

    await this.#accounts.switchActive({ chainRef: options.chainRef, address: options.address });
    return namespaceState;
  }

  #assertNamespace(namespace: string, chainRef: Caip2ChainId): void {
    if (!this.#keyring.hasNamespace(namespace)) {
      throw new Error(`Namespace "${namespace}" is not initialized in the keyring`);
    }
    const { namespace: parsedNamespace } = parseCaip2(chainRef);
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

  async #rollbackAccountAddition(
    options: DeriveAccountOptions,
    address: string,
    namespaceState: NamespaceAccountsState<string> | null,
  ): Promise<void> {
    if (namespaceState) {
      try {
        await this.#accounts.removeAccount({ chainRef: options.chainRef, address });
      } catch (error) {
        this.#logger?.("bridge: failed to rollback account controller state", error);
      }
    }
    try {
      this.#keyring.removeAccount(options.namespace, address);
    } catch (error) {
      this.#logger?.("bridge: failed to rollback keyring state", error);
    }
  }

  async #restoreAccountAfterKeyringFailure(
    options: RemoveAccountOptions,
    previousState: NamespaceAccountsState<string> | undefined,
    previousPointer: ReturnType<AccountsPort["getActivePointer"]>,
  ): Promise<void> {
    const shouldRestorePrimary = previousState?.primary === options.address;
    try {
      await this.#accounts.addAccount({
        chainRef: options.chainRef,
        address: options.address,
        ...(shouldRestorePrimary ? { makePrimary: true } : {}),
      });
      if (
        previousPointer &&
        previousPointer.chainRef === options.chainRef &&
        previousPointer.address === options.address
      ) {
        await this.#accounts.switchActive({ chainRef: options.chainRef, address: options.address });
      }
    } catch (error) {
      this.#logger?.("bridge: failed to restore controller state after keyring removal failure", error);
    }
  }
}
