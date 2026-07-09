import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import {
  KeyringAccountEntryMissingError,
  KeyringAccountNotFoundError,
  KeyringDuplicateAccountError,
  KeyringIndexOutOfRangeError,
  KeyringInvalidMnemonicError,
  KeyringNotInitializedError,
  KeyringSecretUnavailableError,
} from "../errors.js";
import type {
  HierarchicalDeterministicKeyring,
  HierarchicalDeterministicKeyringSnapshot,
  KeyringAccount,
} from "../types.js";
import { canonicalizeEvmAddress, privateKeyToEvmAddress } from "./evmCrypto.js";

const DERIVATION_PREFIX = "m/44'/60'/0'/0";

export type EvmKeyringAccount = KeyringAccount<string>;

type StoredAccount = {
  account: EvmKeyringAccount;
  secret: Uint8Array;
};

export class EvmHdKeyring implements HierarchicalDeterministicKeyring<EvmKeyringAccount> {
  #root: HDKey | null = null;
  #accounts = new Map<string, StoredAccount>();
  #order: string[] = [];
  #derivedIndices = new Map<number, string>();
  #nextIndex = 0;

  hasSecret(): boolean {
    return this.#root?.privateKey != null;
  }

  loadFromMnemonic(mnemonic: string, options?: { passphrase?: string }): void {
    if (!validateMnemonic(mnemonic, wordlist)) {
      throw new KeyringInvalidMnemonicError();
    }

    this.clear();

    const seed = mnemonicToSeedSync(mnemonic, options?.passphrase);
    this.#root = HDKey.fromMasterSeed(seed);
    this.#nextIndex = 0;
  }

  deriveAccount(index: number): EvmKeyringAccount {
    this.#assertHasSecret();
    this.#assertValidIndex(index);
    if (this.#derivedIndices.has(index)) {
      throw new KeyringDuplicateAccountError();
    }

    const { account } = this.#deriveAndStore(index);
    return { ...account };
  }

  deriveNextAccount(): EvmKeyringAccount {
    const index = this.#nextIndex;
    const account = this.deriveAccount(index);
    return account;
  }

  getAccounts(): readonly EvmKeyringAccount[] {
    return this.#order.map((address) => {
      const entry = this.#accounts.get(address);
      if (!entry) {
        throw new KeyringAccountEntryMissingError(address);
      }
      return { ...entry.account };
    });
  }

  getAccount(address: string): EvmKeyringAccount | undefined {
    const canonical = canonicalizeEvmAddress(address);
    const entry = this.#accounts.get(canonical);
    return entry ? { ...entry.account } : undefined;
  }

  hasAccount(address: string): boolean {
    const canonical = canonicalizeEvmAddress(address);
    return this.#accounts.has(canonical);
  }

  removeAccount(address: string): void {
    const canonical = canonicalizeEvmAddress(address);
    const entry = this.#accounts.get(canonical);
    if (!entry) {
      throw new KeyringAccountNotFoundError();
    }

    this.#accounts.delete(canonical);
    this.#order = this.#order.filter((value) => value !== canonical);

    const index = entry.account.derivationIndex;
    if (index != null) {
      this.#derivedIndices.delete(index);
    }
  }

  exportPrivateKey(address: string): Uint8Array {
    const canonical = canonicalizeEvmAddress(address);
    const entry = this.#accounts.get(canonical);
    if (!entry) {
      throw new KeyringAccountNotFoundError();
    }
    return new Uint8Array(entry.secret);
  }

  toSnapshot(): HierarchicalDeterministicKeyringSnapshot<EvmKeyringAccount> {
    return {
      type: "hierarchical",
      accounts: this.getAccounts().map((account) => ({ ...account })),
      nextDerivationIndex: this.#nextIndex,
    };
  }

  hydrate(snapshot: HierarchicalDeterministicKeyringSnapshot<EvmKeyringAccount>): void {
    this.#assertHasSecret();
    this.#clearAccounts();

    for (const account of snapshot.accounts) {
      // Only derived accounts can be hydrated because secrets come from mnemonic
      if (account.source !== "derived" || account.derivationIndex == null) {
        throw new KeyringSecretUnavailableError();
      }
      const derived = this.#deriveAndStore(account.derivationIndex);
      if (derived.account.address !== this.#toCanonicalAddress(account.address)) {
        throw new KeyringSecretUnavailableError();
      }
    }

    this.#nextIndex = Math.max(snapshot.nextDerivationIndex, this.#nextIndex);
  }

  clear(): void {
    this.#clearAccounts();
    if (this.#root) {
      this.#root.wipePrivateData();
      this.#root = null;
    }
    this.#nextIndex = 0;
  }

  #deriveAndStore(index: number): StoredAccount {
    if (!this.#root) {
      throw new KeyringNotInitializedError();
    }

    const node = this.#root.derive(`${DERIVATION_PREFIX}/${index}`);
    let privateKey: Uint8Array | null = null;

    try {
      privateKey = node.privateKey;
      if (!privateKey) {
        throw new KeyringSecretUnavailableError();
      }

      const address = privateKeyToEvmAddress(privateKey);
      if (this.#accounts.has(address)) {
        throw new KeyringDuplicateAccountError();
      }

      const account: EvmKeyringAccount = {
        address,
        derivationPath: `${DERIVATION_PREFIX}/${index}`,
        derivationIndex: index,
        source: "derived",
      };

      const entry = this.#storeAccount(account, privateKey);
      this.#derivedIndices.set(index, address);
      this.#nextIndex = Math.max(this.#nextIndex, index + 1);
      return entry;
    } finally {
      node.wipePrivateData();
    }
  }

  #storeAccount(account: EvmKeyringAccount, secret: Uint8Array): StoredAccount {
    const canonical = canonicalizeEvmAddress(account.address);
    const entry: StoredAccount = {
      account: { ...account, address: canonical },
      secret: new Uint8Array(secret),
    };
    this.#accounts.set(canonical, entry);
    this.#order.push(canonical);
    return entry;
  }

  #clearAccounts(): void {
    this.#accounts.clear();
    this.#order = [];
    this.#derivedIndices.clear();
  }

  #toCanonicalAddress(value: string): string {
    return canonicalizeEvmAddress(value);
  }

  #assertHasSecret(): void {
    if (!this.hasSecret()) {
      throw new KeyringNotInitializedError();
    }
  }

  #assertValidIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0) {
      throw new KeyringIndexOutOfRangeError();
    }
  }
}
