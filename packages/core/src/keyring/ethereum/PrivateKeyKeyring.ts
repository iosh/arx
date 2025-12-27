import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { copyBytes, zeroize } from "../../vault/utils.js";
import { keyringErrors } from "../errors.js";
import type {
  HierarchicalDeterministicKeyring,
  HierarchicalDeterministicKeyringSnapshot,
  KeyringAccount,
  SimpleKeyring,
  SimpleKeyringSnapshot,
} from "../types.js";

const ADDRESS_PATTERN = /^(?:0x)?[0-9a-fA-F]{40}$/;
const PRIVATE_KEY_PATTERN = /^(?:0x)?[0-9a-fA-F]{64}$/;

type Stored = { account: KeyringAccount<string>; secret: Uint8Array };

export class PrivateKeyKeyring implements SimpleKeyring<KeyringAccount<string>> {
  #entry: Stored | null = null;

  hasSecret(): boolean {
    return this.#entry !== null;
  }

  loadFromMnemonic(): void {
    // Single-key keyring does not support mnemonic derivation
    throw keyringErrors.indexOutOfRange();
  }

  // Replace any existing secret with the provided one.
  loadFromPrivateKey(privateKey: string | Uint8Array): void {
    const secret = this.#normalizePrivateKey(privateKey);
    try {
      const address = this.#addressFromSecret(secret);
      this.#clearEntry(); // always replace
      this.#entry = { account: { address, derivationPath: null, derivationIndex: null, source: "imported" }, secret };
    } catch (error) {
      zeroize(secret);
      throw error;
    }
  }

  deriveAccount(): KeyringAccount<string> {
    // Derivation is not supported for single-key keyring
    throw keyringErrors.indexOutOfRange();
  }

  deriveNextAccount(): KeyringAccount<string> {
    return this.deriveAccount();
  }

  importAccount(privateKey: string | Uint8Array): KeyringAccount<string> {
    this.loadFromPrivateKey(privateKey);
    return { ...this.#entry!.account };
  }

  getAccounts(): readonly KeyringAccount<string>[] {
    return this.#entry ? [{ ...this.#entry.account }] : [];
  }

  getAccount(address: string): KeyringAccount<string> | undefined {
    return this.hasAccount(address) ? { ...this.#entry!.account } : undefined;
  }

  hasAccount(address: string): boolean {
    if (!this.#entry) return false;
    return this.#normalizeAddress(address) === this.#entry.account.address;
  }

  removeAccount(address: string): void {
    if (!this.hasAccount(address)) {
      throw keyringErrors.accountNotFound();
    }
    this.#clearEntry();
  }

  exportPrivateKey(address: string): Uint8Array {
    if (!this.hasAccount(address)) {
      throw keyringErrors.accountNotFound();
    }
    return copyBytes(this.#entry!.secret);
  }

  toSnapshot(): SimpleKeyringSnapshot<KeyringAccount<string>> {
    return {
      type: "simple",
      account: this.#entry ? { ...this.#entry.account } : null,
    };
  }

  // Secret must already be loaded (e.g., from Vault) before hydrating metadata.
  hydrate(snapshot: SimpleKeyringSnapshot<KeyringAccount<string>>): void {
    if (!snapshot.account) {
      this.#clearEntry();
      return;
    }
    if (!this.#entry) {
      throw keyringErrors.secretUnavailable();
    }
    const canonical = this.#normalizeAddress(snapshot.account.address);
    if (this.#normalizeAddress(this.#entry.account.address) !== canonical) {
      throw keyringErrors.secretUnavailable();
    }
    this.#entry = {
      account: { address: canonical, derivationPath: null, derivationIndex: null, source: "imported" },
      secret: this.#entry.secret,
    };
  }

  clear(): void {
    this.#clearEntry();
  }

  #clearEntry(): void {
    if (this.#entry) {
      zeroize(this.#entry.secret);
      this.#entry = null;
    }
  }

  #addressFromSecret(secret: Uint8Array): string {
    const publicKey = secp256k1.getPublicKey(secret, false);
    const hash = keccak_256(publicKey.subarray(1));
    const addressBytes = hash.slice(hash.length - 20);
    return `0x${bytesToHex(addressBytes)}`;
  }

  #normalizeAddress(value: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw keyringErrors.invalidAddress();
    }
    const normalized = value.trim().toLowerCase();
    if (!ADDRESS_PATTERN.test(normalized)) {
      throw keyringErrors.invalidAddress();
    }
    return normalized.startsWith("0x") ? normalized : `0x${normalized}`;
  }

  #normalizePrivateKey(value: string | Uint8Array): Uint8Array {
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
}
