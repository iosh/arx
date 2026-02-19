import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
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

const DERIVATION_PREFIX = "m/44'/60'/0'/0";
const ADDRESS_PATTERN = /^(?:0x)?[0-9a-fA-F]{40}$/;
const PRIVATE_KEY_PATTERN = /^(?:0x)?[0-9a-fA-F]{64}$/;

export type EthereumKeyringAccount = KeyringAccount<string>;

type StoredAccount = {
  account: EthereumKeyringAccount;
  secret: Uint8Array;
};

export class EthereumHdKeyring implements HierarchicalDeterministicKeyring<EthereumKeyringAccount> {
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

  deriveAccount(index: number): EthereumKeyringAccount {
    this.#assertHasSecret();
    this.#assertValidIndex(index);
    if (this.#derivedIndices.has(index)) {
      throw keyringErrors.duplicateAccount();
    }

    const { account } = this.#deriveAndStore(index);
    return { ...account };
  }

  deriveNextAccount(): EthereumKeyringAccount {
    const index = this.#nextIndex;
    const account = this.deriveAccount(index);
    return account;
  }

  importAccount(privateKey: string | Uint8Array): EthereumKeyringAccount {
    const secret = this.#parsePrivateKeyBytes(privateKey);
    try {
      const address = this.#addressFromSecret(secret);
      if (this.#accounts.has(address)) {
        throw keyringErrors.duplicateAccount();
      }

      const account: EthereumKeyringAccount = {
        address,
        derivationPath: null,
        derivationIndex: null,
        source: "imported",
      };

      this.#storeAccount(account, secret);
      return { ...account };
    } finally {
      zeroize(secret);
    }
  }

  getAccounts(): readonly EthereumKeyringAccount[] {
    return this.#order.map((address) => {
      const entry = this.#accounts.get(address);
      if (!entry) {
        throw new Error(`Account entry missing for address ${address}`);
      }
      return { ...entry.account };
    });
  }

  getAccount(address: string): EthereumKeyringAccount | undefined {
    const canonical = this.#toCanonicalAddress(address);
    const entry = this.#accounts.get(canonical);
    return entry ? { ...entry.account } : undefined;
  }

  hasAccount(address: string): boolean {
    const canonical = this.#toCanonicalAddress(address);
    return this.#accounts.has(canonical);
  }

  removeAccount(address: string): void {
    const canonical = this.#toCanonicalAddress(address);
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
    const canonical = this.#toCanonicalAddress(address);
    const entry = this.#accounts.get(canonical);
    if (!entry) {
      throw keyringErrors.accountNotFound();
    }
    return copyBytes(entry.secret);
  }

  toSnapshot(): HierarchicalDeterministicKeyringSnapshot<EthereumKeyringAccount> {
    return {
      type: "hierarchical",
      accounts: this.getAccounts().map((account) => ({ ...account })),
      nextDerivationIndex: this.#nextIndex,
    };
  }

  hydrate(snapshot: HierarchicalDeterministicKeyringSnapshot<EthereumKeyringAccount>): void {
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

      const address = this.#addressFromSecret(privateKey);
      if (this.#accounts.has(address)) {
        throw keyringErrors.duplicateAccount();
      }

      const account: EthereumKeyringAccount = {
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

  #storeAccount(account: EthereumKeyringAccount, secret: Uint8Array): StoredAccount {
    const canonical = this.#toCanonicalAddress(account.address);
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

  #addressFromSecret(secret: Uint8Array): string {
    const publicKey = secp256k1.getPublicKey(secret, false);
    const hash = keccak_256(publicKey.subarray(1));
    const addressBytes = hash.slice(hash.length - 20);
    return `0x${bytesToHex(addressBytes)}`;
  }

  #toCanonicalAddress(value: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw keyringErrors.invalidAddress();
    }
    const normalized = value.trim().toLowerCase();
    if (!ADDRESS_PATTERN.test(normalized)) {
      throw keyringErrors.invalidAddress();
    }
    return normalized.startsWith("0x") ? normalized : `0x${normalized}`;
  }

  #parsePrivateKeyBytes(value: string | Uint8Array): Uint8Array {
    if (value instanceof Uint8Array) {
      if (value.length !== 32) {
        throw keyringErrors.invalidPrivateKey();
      }
      return copyBytes(value);
    }

    if (typeof value !== "string" || value.trim().length === 0) {
      throw keyringErrors.invalidPrivateKey();
    }

    const trimmed = value.trim();
    if (!PRIVATE_KEY_PATTERN.test(trimmed)) {
      throw keyringErrors.invalidPrivateKey();
    }

    const bytes = hexToBytes(trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed);
    if (bytes.length !== 32) {
      zeroize(bytes);
      throw keyringErrors.invalidPrivateKey();
    }
    return bytes;
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
