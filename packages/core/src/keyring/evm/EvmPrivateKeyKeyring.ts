import { copyBytes, zeroize } from "../../vault/utils.js";
import { keyringErrors } from "../errors.js";
import type { KeyringAccount, SimpleKeyring, SimpleKeyringSnapshot } from "../types.js";
import { canonicalizeEvmAddress, parsePrivateKeyBytes, privateKeyToEvmAddress } from "./evmCrypto.js";

type Stored = { account: KeyringAccount<string>; secret: Uint8Array };

export class EvmPrivateKeyKeyring implements SimpleKeyring<KeyringAccount<string>> {
  #entry: Stored | null = null;

  hasSecret(): boolean {
    return this.#entry !== null;
  }

  // Replace any existing secret with the provided one.
  loadFromPrivateKey(privateKey: string | Uint8Array): void {
    const secret = parsePrivateKeyBytes(privateKey);
    try {
      const address = privateKeyToEvmAddress(secret);
      this.#clearEntry(); // always replace
      this.#entry = { account: { address, derivationPath: null, derivationIndex: null, source: "imported" }, secret };
    } catch (error) {
      zeroize(secret);
      throw error;
    }
  }

  importAccount(privateKey: string | Uint8Array): KeyringAccount<string> {
    this.loadFromPrivateKey(privateKey);
    const entry = this.#entry;
    if (!entry) {
      // Defensive: loadFromPrivateKey should always set this.
      throw new Error("Private key entry not initialized");
    }
    return { ...entry.account };
  }

  getAccounts(): readonly KeyringAccount<string>[] {
    return this.#entry ? [{ ...this.#entry.account }] : [];
  }

  getAccount(address: string): KeyringAccount<string> | undefined {
    const entry = this.#entry;
    if (!entry) return undefined;
    return this.#toCanonicalAddress(address) === entry.account.address ? { ...entry.account } : undefined;
  }

  hasAccount(address: string): boolean {
    if (!this.#entry) return false;
    return this.#toCanonicalAddress(address) === this.#entry.account.address;
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
    const entry = this.#entry;
    if (!entry) {
      throw keyringErrors.secretUnavailable();
    }
    return copyBytes(entry.secret);
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
    const canonical = this.#toCanonicalAddress(snapshot.account.address);
    if (this.#toCanonicalAddress(this.#entry.account.address) !== canonical) {
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

  #toCanonicalAddress(value: string): string {
    return canonicalizeEvmAddress(value);
  }
}
