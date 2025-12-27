import { ArxReasons, isArxError } from "@arx/errors";
import { generateMnemonic as BIP39Generate, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { keyringErrors } from "../../errors/keyring.js";
import { vaultErrors } from "../../errors/vault.js";
import type { KeyringKind, NamespaceConfig } from "../../keyring/namespace.js";
import { getAddressKey } from "../../keyring/namespace.js";
import type { HierarchicalDeterministicKeyring, SimpleKeyring } from "../../keyring/types.js";
import { KEYRING_VAULT_ENTRY_VERSION } from "../../storage/keyringSchemas.js";
import { KeyringHydration } from "./KeyringHydration.js";
import { decodePayload, encodePayload } from "./keyring-utils.js";
import type {
  AccountMeta,
  KeyringMeta,
  KeyringServiceOptions,
  MultiNamespaceAccountsState,
  NamespaceAccountsState,
  Payload,
  RuntimeKeyring,
  VaultKeyringEntry,
} from "./types.js";

export class KeyringService {
  #options: KeyringServiceOptions;
  #namespacesConfig: Map<string, NamespaceConfig>;
  #keyrings = new Map<string, RuntimeKeyring>();
  #keyringMetas = new Map<string, KeyringMeta>();
  #accountMetas = new Map<string, AccountMeta>();
  #payload: Payload = { keyrings: [] };
  #payloadListeners = new Set<(payload: Uint8Array | null) => void>();
  #addressIndex = new Map<string, { namespace: string; keyringId: string }>();
  #hydration: KeyringHydration;

  constructor(options: KeyringServiceOptions) {
    this.#options = options;
    this.#namespacesConfig = new Map(options.namespaces.map((ns) => [ns.namespace, ns]));
    this.#hydration = new KeyringHydration(
      options,
      {
        keyrings: this.#keyrings,
        keyringMetas: this.#keyringMetas,
        accountMetas: this.#accountMetas,
      },
      (payload) => this.#onHydrated(payload),
    );
  }

  async attach() {
    await this.#hydration.attach();
  }

  detach() {
    this.#hydration.detach();
  }

  onPayloadUpdated(handler: (payload: Uint8Array | null) => void): () => void {
    this.#payloadListeners.add(handler);
    return () => this.#payloadListeners.delete(handler);
  }

  getNamespaces(): NamespaceConfig[] {
    return Array.from(this.#namespacesConfig.values());
  }

  getKeyrings(): KeyringMeta[] {
    return Array.from(this.#keyringMetas.values()).map((m) => ({ ...m }));
  }

  getAccounts(includeHidden = false): AccountMeta[] {
    return Array.from(this.#accountMetas.values())
      .filter((a) => includeHidden || !a.hidden)
      .map((a) => ({ ...a }));
  }

  generateMnemonic(wordCount: 12 | 24 = 12): string {
    const strength = wordCount === 24 ? 256 : 128;
    return BIP39Generate(wordlist, strength);
  }

  async confirmNewMnemonic(mnemonic: string, opts?: { alias?: string; skipBackup?: boolean; namespace?: string }) {
    await this.#waitForHydration();
    return this.#importMnemonic(mnemonic, { ...opts, fresh: true });
  }

  async importMnemonic(mnemonic: string, opts?: { alias?: string; namespace?: string }) {
    await this.#waitForHydration();
    return this.#importMnemonic(mnemonic, { ...opts, fresh: false });
  }

  async importPrivateKey(privateKey: string | Uint8Array, opts?: { alias?: string; namespace?: string }) {
    await this.#waitForHydration();
    this.#assertUnlocked();
    const namespace = opts?.namespace ?? this.#defaultNamespace();
    const config = this.#getConfig(namespace);
    const factory = config.factories["private-key"];
    if (!factory) throw new Error(`Namespace "${namespace}" does not support private-key keyring`);

    const keyring = factory();
    keyring.loadFromPrivateKey(privateKey);
    const [account] = keyring.getAccounts();
    if (!account) throw keyringErrors.secretUnavailable();

    const canonical = config.normalizeAddress(account.address);
    this.#assertNoDuplicate(namespace, canonical);

    const now = Date.now();
    const keyringId = crypto.randomUUID();
    const meta: KeyringMeta = { id: keyringId, type: "private-key", createdAt: now, alias: opts?.alias };
    const accountMeta: AccountMeta = {
      address: canonical,
      keyringId,
      derivationIndex: undefined,
      alias: opts?.alias,
      createdAt: now,
      namespace,
    };

    await this.#persistNewKeyring({
      keyringId,
      kind: "private-key",
      namespace,
      instance: keyring,
      vaultEntry: {
        keyringId,
        type: "private-key",
        createdAt: now,
        version: KEYRING_VAULT_ENTRY_VERSION,
        namespace,
        payload: { privateKey: typeof privateKey === "string" ? privateKey : Buffer.from(privateKey).toString("hex") },
      },
      meta,
      accounts: [accountMeta],
    });

    return { keyringId, account: { ...account, address: canonical } };
  }

  async deriveAccount(keyringId: string) {
    await this.#waitForHydration();
    this.#assertUnlocked();
    const runtime = this.#keyrings.get(keyringId);
    if (!runtime) throw new Error(`Keyring "${keyringId}" not found`);
    if (runtime.kind !== "hd") throw keyringErrors.indexOutOfRange();
    const meta = this.#keyringMetas.get(keyringId);
    if (!meta) throw new Error(`Keyring meta missing for ${keyringId}`);

    const instance = runtime.instance as HierarchicalDeterministicKeyring;
    const index = meta.derivedCount ?? 0;
    const derived = instance.deriveAccount(index);
    const canonical = this.#normalize(runtime.namespace, derived.address);

    this.#assertNoDuplicate(runtime.namespace, canonical);

    const now = Date.now();
    const accountMeta: AccountMeta = {
      address: canonical,
      keyringId,
      derivationIndex: index,
      createdAt: now,
      namespace: runtime.namespace,
    };

    this.#accountMetas.set(canonical, accountMeta);
    this.#keyringMetas.set(keyringId, { ...meta, derivedCount: index + 1 });
    this.#indexAccounts();

    await this.#options.keyringStore.putAccountMetas(this.getAccounts(true));
    await this.#options.keyringStore.putKeyringMetas(this.getKeyrings());

    this.#syncAccountsState();
    this.#notifyPayloadUpdated();
    return { ...derived, address: canonical };
  }

  async hideHdAccount(address: string): Promise<void> {
    await this.#toggleHidden(address, true);
  }

  async unhideHdAccount(address: string): Promise<void> {
    await this.#toggleHidden(address, false);
  }

  async removePrivateKeyKeyring(keyringId: string): Promise<void> {
    await this.#waitForHydration();
    const runtime = this.#keyrings.get(keyringId);
    if (!runtime) return;
    if (runtime.kind !== "private-key") throw keyringErrors.indexOutOfRange();

    this.#keyrings.delete(keyringId);
    this.#keyringMetas.delete(keyringId);
    for (const [addr, meta] of Array.from(this.#accountMetas.entries())) {
      if (meta.keyringId === keyringId) this.#accountMetas.delete(addr);
    }

    this.#payload.keyrings = this.#payload.keyrings.filter((entry) => entry.keyringId !== keyringId);
    this.#indexAccounts();
    await this.#options.keyringStore.deleteKeyringMeta(keyringId);
    await this.#options.keyringStore.deleteAccountsByKeyring(keyringId);

    this.#syncAccountsState();
    this.#notifyPayloadUpdated();
  }

  renameKeyring(keyringId: string, alias: string): Promise<void> {
    const meta = this.#keyringMetas.get(keyringId);
    if (!meta) return Promise.resolve();
    this.#keyringMetas.set(keyringId, { ...meta, alias });
    return this.#options.keyringStore.putKeyringMetas(this.getKeyrings());
  }

  async renameAccount(address: string, alias: string): Promise<void> {
    const ref = await this.getAccountRef(address);
    const canonical = this.#normalize(ref.namespace, address);
    const meta = this.#accountMetas.get(canonical);
    if (!meta) return Promise.resolve();
    this.#accountMetas.set(canonical, { ...meta, alias });
    return this.#options.keyringStore.putAccountMetas(this.getAccounts(true));
  }

  markBackedUp(keyringId: string): Promise<void> {
    const meta = this.#keyringMetas.get(keyringId);
    if (!meta) return Promise.resolve();
    this.#keyringMetas.set(keyringId, { ...meta, backedUp: true });
    return this.#options.keyringStore.putKeyringMetas(this.getKeyrings());
  }

  hasNamespace(namespace: string): boolean {
    return this.#namespacesConfig.has(namespace);
  }

  async removeAccount(namespace: string, address: string): Promise<void> {
    await this.#waitForHydration();
    const canonical = this.#normalize(namespace, address);
    const meta = this.#accountMetas.get(canonical);
    if (!meta) throw keyringErrors.accountNotFound();
    const runtime = this.#keyrings.get(meta.keyringId);

    if (runtime) {
      runtime.instance.removeAccount(address);
    } else {
      this.#options.logger?.(`keyring: runtime missing for keyring "${meta.keyringId}", deleting metadata only`);
    }

    this.#accountMetas.delete(canonical);

    const isSingleAccountKeyring =
      runtime?.kind === "private-key" || (!runtime && this.#keyringMetas.get(meta.keyringId)?.type === "private-key");

    if (isSingleAccountKeyring) {
      // Single-account keyring: remove entire keyring
      this.#keyrings.delete(meta.keyringId);
      this.#keyringMetas.delete(meta.keyringId);
      this.#payload.keyrings = this.#payload.keyrings.filter((entry) => entry.keyringId !== meta.keyringId);
      await this.#options.keyringStore.deleteKeyringMeta(meta.keyringId);
    } else {
      // HD keyring: only delete the specific account
      await this.#options.keyringStore.deleteAccount(canonical);
    }

    this.#indexAccounts();
    this.#syncAccountsState();
    this.#notifyPayloadUpdated();
  }

  hasAccount(namespace: string, address: string): boolean {
    const key = this.#toKey(namespace, address);
    return this.#addressIndex.has(key);
  }

  async exportPrivateKey(namespace: string, address: string, password: string): Promise<Uint8Array> {
    await this.#waitForHydration();
    await this.#verifyPassword(password);
    return this.#exportPrivateKeyUnsafe(namespace, address);
  }

  async exportPrivateKeyForSigning(namespace: string, address: string): Promise<Uint8Array> {
    return this.#exportPrivateKeyUnsafe(namespace, address);
  }

  async exportMnemonic(keyringId: string, password: string): Promise<string> {
    await this.#waitForHydration();
    await this.#verifyPassword(password);
    const entry = this.#payload.keyrings.find((k) => k.keyringId === keyringId && k.type === "hd");
    if (!entry) throw keyringErrors.accountNotFound();
    const payload = entry.payload as { mnemonic: string[]; passphrase?: string };
    return payload.mnemonic.join(" ");
  }

  getAccountsByKeyring(keyringId: string, includeHidden = false): AccountMeta[] {
    return this.getAccounts(includeHidden).filter((a) => a.keyringId === keyringId);
  }

  async getAccountRef(address: string): Promise<{ namespace: string; keyringId: string }> {
    await this.#waitForHydration();
    for (const [namespace, config] of this.#namespacesConfig) {
      const key = getAddressKey(namespace, address, config.normalizeAddress);
      const ref = this.#addressIndex.get(key);
      if (ref) return { namespace, keyringId: ref.keyringId };
    }
    throw keyringErrors.accountNotFound();
  }
  async exportPrivateKeyByAddress(address: string, password: string): Promise<Uint8Array> {
    const ref = await this.getAccountRef(address);
    return this.exportPrivateKey(ref.namespace, address, password);
  }

  async onLock(): Promise<void> {
    this.#hydration.clear();
    this.#onHydrated(null);
  }

  // ----- private helpers -----

  #onHydrated(payload?: Payload | null) {
    if (payload) {
      this.#payload = payload;
    } else if (payload === null) {
      this.#payload = { keyrings: [] };
    } else if (this.#options.vault.isUnlocked()) {
      this.#payload = decodePayload(this.#options.vault.exportKey(), this.#options.logger);
    } else {
      this.#payload = { keyrings: [] };
    }
    this.#indexAccounts(false);
    this.#syncAccountsState();
    this.#notifyPayloadUpdated();
  }

  async #waitForHydration(): Promise<void> {
    await this.#hydration.waitForHydration();
  }

  async waitForReady(): Promise<void> {
    await this.#hydration.waitForHydration();
  }

  async #exportPrivateKeyUnsafe(namespace: string, address: string): Promise<Uint8Array> {
    await this.#waitForHydration();
    const canonical = this.#normalize(namespace, address);
    const key = this.#toKey(namespace, canonical);
    const indexed = this.#addressIndex.get(key);
    if (!indexed) throw keyringErrors.accountNotFound();
    const runtime = this.#getRuntimeKeyring(namespace, indexed.keyringId);
    return runtime.instance.exportPrivateKey(canonical);
  }

  async #verifyPassword(password: string) {
    try {
      await this.#options.vault.verifyPassword(password);
    } catch (error) {
      if (isArxError(error) && error.reason === ArxReasons.VaultInvalidPassword) throw error;
      throw error;
    }
  }

  async #importMnemonic(
    mnemonic: string,
    opts: { alias?: string; skipBackup?: boolean; namespace?: string; fresh: boolean },
  ) {
    this.#assertUnlocked();
    const normalized = mnemonic.trim().replace(/\s+/g, " ");
    if (!validateMnemonic(normalized, wordlist)) {
      throw keyringErrors.invalidMnemonic();
    }

    const namespace = opts.namespace ?? this.#defaultNamespace();

    const existingHd = this.#payload.keyrings.find(
      (entry) =>
        entry.type === "hd" &&
        (entry.namespace ?? this.#defaultNamespace()) === namespace &&
        Array.isArray((entry.payload as { mnemonic?: unknown[] }).mnemonic) &&
        (entry.payload as { mnemonic: string[] }).mnemonic.join(" ") === normalized,
    );

    if (existingHd) {
      throw keyringErrors.duplicateAccount();
    }

    const words = normalized.split(" ");
    const config = this.#getConfig(namespace);

    const factory = config.factories.hd;
    if (!factory) throw new Error(`Namespace "${namespace}" does not support hd keyring`);

    const keyring = factory();
    keyring.loadFromMnemonic(normalized);
    const first = keyring.deriveNextAccount();
    const canonical = config.normalizeAddress(first.address);
    this.#assertNoDuplicate(namespace, canonical);

    const now = Date.now();
    const keyringId = crypto.randomUUID();
    const meta: KeyringMeta = {
      id: keyringId,
      type: "hd",
      createdAt: now,
      alias: opts.alias,
      backedUp: opts.skipBackup ? false : true,
      derivedCount: 1,
    };
    const accountMeta: AccountMeta = {
      address: canonical,
      keyringId,
      derivationIndex: 0,
      alias: opts.alias,
      createdAt: now,
      namespace,
    };

    await this.#persistNewKeyring({
      keyringId,
      kind: "hd",
      namespace,
      instance: keyring,
      vaultEntry: {
        keyringId,
        type: "hd",
        createdAt: now,
        version: KEYRING_VAULT_ENTRY_VERSION,
        namespace,
        payload: { mnemonic: words, passphrase: undefined },
      },
      meta,
      accounts: [accountMeta],
    });

    return { keyringId, address: canonical };
  }

  async #persistNewKeyring(params: {
    keyringId: string;
    kind: KeyringKind;
    namespace: string;
    instance: HierarchicalDeterministicKeyring | SimpleKeyring;
    vaultEntry: VaultKeyringEntry;
    meta: KeyringMeta;
    accounts: AccountMeta[];
  }) {
    this.#keyrings.set(params.keyringId, {
      id: params.keyringId,
      kind: params.kind,
      namespace: params.namespace,
      instance: params.instance,
    });
    this.#payload.keyrings = [
      ...this.#payload.keyrings.filter((k) => k.keyringId !== params.keyringId),
      params.vaultEntry,
    ];
    this.#keyringMetas.set(params.keyringId, params.meta);
    for (const acct of params.accounts) {
      this.#accountMetas.set(acct.address, acct);
    }
    this.#indexAccounts();

    await this.#options.keyringStore.putKeyringMetas(this.getKeyrings());
    await this.#options.keyringStore.putAccountMetas(this.getAccounts(true));
    this.#syncAccountsState();
    this.#notifyPayloadUpdated();
  }

  #notifyPayloadUpdated() {
    const encoded = encodePayload(this.#payload);
    for (const listener of this.#payloadListeners) {
      try {
        listener(encoded.length > 0 ? new Uint8Array(encoded) : null);
      } catch (error) {
        this.#options.logger?.("keyring: payload listener threw", error);
      }
    }
  }

  #indexAccounts(strict = true) {
    this.#addressIndex.clear();
    for (const runtime of this.#keyrings.values()) {
      const normalize = this.#getConfig(runtime.namespace).normalizeAddress;
      const accounts = this.getAccounts(true).filter((a) => a.keyringId === runtime.id);
      for (const account of accounts) {
        const key = getAddressKey(runtime.namespace, account.address, normalize);
        if (this.#addressIndex.has(key)) {
          if (strict) {
            throw keyringErrors.duplicateAccount();
          } else {
            this.#options.logger?.(`keyring: duplicate account skipped during hydrate: ${key}`);
            continue;
          }
        }
        this.#addressIndex.set(key, { namespace: runtime.namespace, keyringId: runtime.id });
      }
    }
  }

  #syncAccountsState() {
    const current = this.#options.accounts.getState();
    const ns = this.#defaultNamespace();
    const visible = this.getAccounts(false).map((a) => a.address);
    const previous = current.namespaces[ns] ?? { all: [], primary: null };
    const primary = previous.primary && visible.includes(previous.primary) ? previous.primary : (visible[0] ?? null);
    const namespaces: Record<string, NamespaceAccountsState<string>> = {
      ...current.namespaces,
      [ns]: { all: visible, primary },
    };
    const active =
      current.active &&
      current.active.namespace === ns &&
      current.active.address &&
      visible.includes(current.active.address)
        ? current.active
        : primary
          ? { namespace: ns, chainRef: current.active?.chainRef ?? ns + ":1", address: primary }
          : null;

    const nextState: MultiNamespaceAccountsState<string> = { namespaces, active };
    this.#options.accounts.replaceState(nextState);
  }

  async #toggleHidden(address: string, hidden: boolean) {
    await this.#waitForHydration();
    this.#assertUnlocked();
    const ref = await this.getAccountRef(address);
    const canonical = this.#normalize(ref.namespace, address);
    const meta = this.#accountMetas.get(canonical);
    if (!meta) throw keyringErrors.accountNotFound();
    this.#accountMetas.set(canonical, { ...meta, hidden });
    await this.#options.keyringStore.putAccountMetas(this.getAccounts(true));
    this.#syncAccountsState();
  }

  #normalize(namespace: string, address: string): string {
    return this.#getConfig(namespace).normalizeAddress(address);
  }

  #assertNoDuplicate(namespace: string, address: string) {
    const key = this.#toKey(namespace, address);
    if (this.#addressIndex.has(key)) {
      throw keyringErrors.duplicateAccount();
    }
  }

  #assertUnlocked() {
    if (!this.#options.vault.isUnlocked()) {
      throw keyringErrors.secretUnavailable();
    }
  }

  #toKey(namespace: string, address: string): string {
    return getAddressKey(namespace, address, this.#getConfig(namespace).normalizeAddress);
  }

  #getRuntimeKeyring(namespace: string, keyringId: string): RuntimeKeyring {
    const runtime = this.#keyrings.get(keyringId);
    if (!runtime || runtime.namespace !== namespace) {
      throw new Error(`Keyring "${keyringId}" is not initialized`);
    }
    return runtime;
  }

  #getConfig(namespace: string): NamespaceConfig {
    const config = this.#namespacesConfig.get(namespace);
    if (!config) throw new Error(`Namespace "${namespace}" is not supported`);
    return config;
  }

  #defaultNamespace(): string {
    const [first] = this.#namespacesConfig.keys();
    if (!first) throw new Error("No keyring namespace configured");
    return first;
  }
}
