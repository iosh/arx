import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { copyBytes, zeroize } from "../../vault/utils.js";
import { keyringErrors } from "../errors.js";
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
      throw keyringErrors.invalidMnemonic();
    }

    this.clear();

    const seed = mnemonicToSeedSync(mnemonic, options?.passphrase);
    try {
      this.#root = HDKey.fromMasterSeed(seed);
    } finally {
      zeroize(seed);
    }
    this.#nextIndex = 0;
  }

  deriveAccount(index: number): EvmKeyringAccount {
    this.#assertHasSecret();
    this.#assertValidIndex(index);
    if (this.#derivedIndices.has(index)) {
      throw keyringErrors.duplicateAccount();
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
        throw new Error(`Account entry missing for address ${address}`);
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
      throw keyringErrors.accountNotFound();
    }

    this.#accounts.delete(canonical);
    this.#order = this.#order.filter((value) => value !== canonical);

    const index = entry.account.derivationIndex;
    if (index != null) {
      this.#derivedIndices.delete(index);
    }

    zeroize(entry.secret);
  }

  exportPrivateKey(address: string): Uint8Array {
    const canonical = canonicalizeEvmAddress(address);
    const entry = this.#accounts.get(canonical);
    if (!entry) {
      throw keyringErrors.accountNotFound();
    }
    return copyBytes(entry.secret);
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
        throw keyringErrors.secretUnavailable();
      }
      const derived = this.#deriveAndStore(account.derivationIndex);
      if (derived.account.address !== this.#toCanonicalAddress(account.address)) {
        throw keyringErrors.secretUnavailable();
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
      throw keyringErrors.notInitialized();
    }

    const node = this.#root.derive(`${DERIVATION_PREFIX}/${index}`);
    let privateKey: Uint8Array | null = null;

    try {
      privateKey = node.privateKey;
      if (!privateKey) {
        throw keyringErrors.secretUnavailable();
      }

      const address = privateKeyToEvmAddress(privateKey);
      if (this.#accounts.has(address)) {
        throw keyringErrors.duplicateAccount();
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
      if (privateKey) {
        zeroize(privateKey);
      }
      node.wipePrivateData();
    }
  }

  #storeAccount(account: EvmKeyringAccount, secret: Uint8Array): StoredAccount {
    const canonical = canonicalizeEvmAddress(account.address);
    const entry: StoredAccount = {
      account: { ...account, address: canonical },
      secret: copyBytes(secret),
    };
    this.#accounts.set(canonical, entry);
    this.#order.push(canonical);
    return entry;
  }

  #clearAccounts(): void {
    for (const entry of this.#accounts.values()) {
      zeroize(entry.secret);
    }
    this.#accounts.clear();
    this.#order = [];
    this.#derivedIndices.clear();
  }

  #toCanonicalAddress(value: string): string {
    return canonicalizeEvmAddress(value);
  }

  #assertHasSecret(): void {
    if (!this.hasSecret()) {
      throw keyringErrors.notInitialized();
    }
  }

  #assertValidIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0) {
      throw keyringErrors.indexOutOfRange();
    }
  }
}
