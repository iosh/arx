import { ArxReasons, isArxError } from "@arx/errors";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateMnemonic as BIP39Generate, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { keyringErrors } from "../../keyring/errors.js";
import type { HierarchicalDeterministicKeyring, SimpleKeyring } from "../../keyring/types.js";
import { KEYRING_VAULT_ENTRY_VERSION } from "../../storage/keyringSchemas.js";
import {
  AccountIdSchema,
  type AccountRecord,
  AccountRecordSchema,
  KeyringMetaRecordSchema,
} from "../../storage/records.js";
import { vaultErrors } from "../../vault/errors.js";
import { zeroize } from "../../vault/utils.js";
import { KeyringHydration } from "./KeyringHydration.js";
import { decodePayload, encodePayload } from "./keyring-utils.js";
import type { KeyringKind, NamespaceConfig } from "./namespaces.js";
import type {
  AccountId,
  KeyringMetaRecord,
  KeyringPayloadListener,
  KeyringServiceOptions,
  Payload,
  RuntimeKeyring,
  VaultKeyringEntry,
} from "./types.js";

export class KeyringService {
  #options: KeyringServiceOptions;
  #namespacesConfig: Map<string, NamespaceConfig>;

  #keyrings = new Map<string, RuntimeKeyring>();
  #keyringMetas = new Map<string, KeyringMetaRecord>();
  #accounts = new Map<AccountId, AccountRecord>();

  #payload: Payload = { keyrings: [] };
  #payloadListeners = new Set<KeyringPayloadListener>();

  #addressIndex = new Map<AccountId, { namespace: string; keyringId: string; accountId: AccountId }>();
  #hydration: KeyringHydration;

  constructor(options: KeyringServiceOptions) {
    this.#options = options;
    this.#namespacesConfig = new Map(options.namespaces.map((ns) => [ns.namespace, ns]));
    this.#hydration = new KeyringHydration(
      options,
      { keyrings: this.#keyrings, keyringMetas: this.#keyringMetas, accounts: this.#accounts },
      (payload) => this.#onHydrated(payload),
    );
  }

  async attach() {
    await this.#hydration.attach();
  }

  detach() {
    this.#hydration.detach();
  }

  async waitForReady(): Promise<void> {
    await this.#hydration.waitForHydration();
  }

  onPayloadUpdated(handler: KeyringPayloadListener): () => void {
    this.#payloadListeners.add(handler);
    return () => this.#payloadListeners.delete(handler);
  }

  hasNamespace(namespace: string): boolean {
    return this.#namespacesConfig.has(namespace);
  }

  getNamespaces(): NamespaceConfig[] {
    return Array.from(this.#namespacesConfig.values());
  }

  getKeyrings(): KeyringMetaRecord[] {
    return Array.from(this.#keyringMetas.values())
      .map((m) => ({ ...m }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  getAccounts(includeHidden = false): AccountRecord[] {
    return Array.from(this.#accounts.values())
      .filter((a) => includeHidden || !a.hidden)
      .map((a) => ({ ...a }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  getAccountsByKeyring(keyringId: string, includeHidden = false): AccountRecord[] {
    return this.getAccounts(includeHidden).filter((a) => a.keyringId === keyringId);
  }

  generateMnemonic(wordCount: 12 | 24 = 12): string {
    const strength = wordCount === 24 ? 256 : 128;
    return BIP39Generate(wordlist, strength);
  }

  async confirmNewMnemonic(mnemonic: string, opts?: { name?: string; skipBackup?: boolean; namespace?: string }) {
    await this.#waitForHydration();
    return this.#importMnemonic(mnemonic, { ...opts, fresh: true });
  }

  async importMnemonic(mnemonic: string, opts?: { name?: string; namespace?: string }) {
    await this.#waitForHydration();
    return this.#importMnemonic(mnemonic, { ...opts, fresh: false });
  }

  async importPrivateKey(privateKey: string | Uint8Array, opts?: { name?: string; namespace?: string }) {
    await this.#waitForHydration();
    this.#assertUnlocked();

    const namespace = opts?.namespace ?? this.#defaultNamespace();
    const config = this.#getConfig(namespace);
    const factory = config.factories["private-key"];
    if (!factory) throw new Error(`Namespace "${namespace}" does not support private-key keyring`);

    const instance = factory();
    instance.loadFromPrivateKey(privateKey);
    const [account] = instance.getAccounts();
    if (!account) throw keyringErrors.secretUnavailable();

    const canonical = this.#toCanonicalString(namespace, account.address);
    const accountId = this.#toAccountId(namespace, canonical);
    this.#assertNoDuplicate(accountId);

    const now = this.#options.now();
    const keyringId = this.#options.uuid();

    const secret = instance.exportPrivateKey(canonical);
    const secretHex = bytesToHex(secret);
    zeroize(secret);

    const payloadEntry: VaultKeyringEntry = {
      keyringId,
      type: "private-key",
      createdAt: now,
      version: KEYRING_VAULT_ENTRY_VERSION,
      namespace,
      // Persist without a 0x prefix for stable encoding across platforms.
      payload: { privateKey: secretHex },
    };

    const meta: KeyringMetaRecord = KeyringMetaRecordSchema.parse({
      id: keyringId,
      type: "private-key",
      name: opts?.name,
      createdAt: now,
    });

    const record = this.#buildAccountRecord({
      namespace,
      address: canonical,
      keyringId,
      createdAt: now,
      ...(opts?.name !== undefined ? { alias: opts.name } : {}),
    });

    await this.#persistNewKeyring({
      keyringId,
      kind: "private-key",
      namespace,
      instance,
      meta,
      accounts: [record],
      payloadEntry,
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
    if (!meta) throw new Error(`Keyring metadata missing for ${keyringId}`);

    const instance = runtime.instance as HierarchicalDeterministicKeyring;

    const index = this.#resolveNextDerivationIndex(keyringId, meta);
    const derived = instance.deriveAccount(index);

    const canonical = this.#toCanonicalString(runtime.namespace, derived.address);
    const accountId = this.#toAccountId(runtime.namespace, canonical);
    this.#assertNoDuplicate(accountId);

    const now = this.#options.now();
    const record = this.#buildAccountRecord({
      namespace: runtime.namespace,
      address: canonical,
      keyringId,
      createdAt: now,
      derivationIndex: index,
    });

    const nextMeta: KeyringMetaRecord = KeyringMetaRecordSchema.parse({
      ...meta,
      nextDerivationIndex: index + 1,
    });

    // Persist metadata first; the vault payload is already present.
    await this.#options.accountsStore.upsert(record);
    await this.#options.keyringMetas.upsert(nextMeta);

    this.#accounts.set(record.accountId, record);
    this.#keyringMetas.set(keyringId, nextMeta);
    this.#indexAccounts();

    return { ...derived, address: canonical };
  }

  async hideHdAccount(accountId: AccountId): Promise<void> {
    await this.#setAccountHidden(accountId, true);
  }

  async unhideHdAccount(accountId: AccountId): Promise<void> {
    await this.#setAccountHidden(accountId, false);
  }

  async renameKeyring(keyringId: string, name: string): Promise<void> {
    const meta = this.#keyringMetas.get(keyringId);
    if (!meta) return;

    const next: KeyringMetaRecord = KeyringMetaRecordSchema.parse({ ...meta, name });
    await this.#options.keyringMetas.upsert(next);
    this.#keyringMetas.set(keyringId, next);
  }

  async renameAccount(accountId: AccountId, alias: string): Promise<void> {
    const record = this.#accounts.get(accountId);
    if (!record) return;

    const next: AccountRecord = AccountRecordSchema.parse({ ...record, alias });
    await this.#options.accountsStore.upsert(next);
    this.#accounts.set(accountId, next);
  }

  async markBackedUp(keyringId: string): Promise<void> {
    const meta = this.#keyringMetas.get(keyringId);
    if (!meta) return;
    if (meta.type !== "hd") return;

    const next: KeyringMetaRecord = KeyringMetaRecordSchema.parse({ ...meta, needsBackup: false });
    await this.#options.keyringMetas.upsert(next);
    this.#keyringMetas.set(keyringId, next);
  }

  async removePrivateKeyKeyring(keyringId: string): Promise<void> {
    await this.#waitForHydration();

    const runtime = this.#keyrings.get(keyringId);
    const meta = this.#keyringMetas.get(keyringId);

    if (!runtime && !meta) return;
    if (runtime?.kind !== "private-key" && meta?.type !== "private-key") {
      throw keyringErrors.indexOutOfRange();
    }

    await this.#removeKeyring({ keyringId });
  }

  async removeAccount(namespace: string, address: string): Promise<void> {
    await this.#waitForHydration();

    const canonical = this.#toCanonicalString(namespace, address);
    const accountId = this.#toAccountId(namespace, canonical);
    const ref = this.#addressIndex.get(accountId);
    if (!ref) throw keyringErrors.accountNotFound();

    const record = this.#accounts.get(ref.accountId);
    if (!record) throw keyringErrors.accountNotFound();

    const meta = this.#keyringMetas.get(record.keyringId);
    if (!meta) {
      // Orphaned account metadata; drop it.
      await this.#options.accountsStore.remove(record.accountId);
      this.#accounts.delete(record.accountId);
      this.#indexAccounts(false);
      return;
    }

    if (meta.type === "private-key") {
      await this.#removeKeyring({ keyringId: record.keyringId });
      return;
    }

    await this.#options.accountsStore.remove(record.accountId);
    this.#accounts.delete(record.accountId);
    this.#indexAccounts(false);
  }

  async exportMnemonic(keyringId: string, password: string): Promise<string> {
    await this.#waitForHydration();
    await this.#verifyPassword(password);

    const entry = this.#payload.keyrings.find((k) => k.keyringId === keyringId && k.type === "hd");
    if (!entry) throw keyringErrors.accountNotFound();
    const payload = entry.payload as { mnemonic: string[]; passphrase?: string };
    return payload.mnemonic.join(" ");
  }

  async exportPrivateKey(namespace: string, address: string, password: string): Promise<Uint8Array> {
    await this.#waitForHydration();
    await this.#verifyPassword(password);
    return this.#exportPrivateKeyUnsafe(namespace, address);
  }

  hasAccount(namespace: string, address: string): boolean {
    const canonical = this.#toCanonicalString(namespace, address);
    const accountId = this.#toAccountId(namespace, canonical);
    return this.hasAccountId(accountId);
  }

  hasAccountId(accountId: AccountId): boolean {
    return this.#addressIndex.has(accountId);
  }

  async exportPrivateKeyByAccountId(accountId: AccountId, password: string): Promise<Uint8Array> {
    await this.#waitForHydration();
    await this.#verifyPassword(password);
    return this.#exportPrivateKeyByAccountIdUnsafe(accountId);
  }

  async signDigestByAccountId(params: { accountId: AccountId; digest: Uint8Array }): Promise<{
    r: bigint;
    s: bigint;
    yParity: number;
    bytes: Uint8Array;
  }> {
    const { accountId, digest } = params;
    await this.#waitForHydration();

    if (digest.length !== 32) {
      throw new Error(`signDigestByAccountId expects a 32-byte digest, got ${digest.length}`);
    }

    const secret = await this.#exportPrivateKeyByAccountIdUnsafe(accountId);
    try {
      const signature = secp256k1.sign(digest, secret, { lowS: true });
      return {
        r: signature.r,
        s: signature.s,
        yParity: signature.recovery,
        bytes: signature.toCompactRawBytes(),
      };
    } finally {
      zeroize(secret);
    }
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
    void this.#notifyPayloadUpdated();
  }

  async #waitForHydration(): Promise<void> {
    await this.#hydration.waitForHydration();
  }

  #assertUnlocked(): void {
    if (!this.#options.unlock.isUnlocked()) {
      throw vaultErrors.locked();
    }
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
    opts: { name?: string; skipBackup?: boolean; namespace?: string; fresh: boolean },
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

    const instance = factory();
    instance.loadFromMnemonic(normalized);
    const first = instance.deriveNextAccount();

    const canonical = this.#toCanonicalString(namespace, first.address);
    const accountId = this.#toAccountId(namespace, canonical);
    this.#assertNoDuplicate(accountId);

    const now = this.#options.now();
    const keyringId = this.#options.uuid();

    const payloadEntry: VaultKeyringEntry = {
      keyringId,
      type: "hd",
      createdAt: now,
      version: KEYRING_VAULT_ENTRY_VERSION,
      namespace,
      payload: { mnemonic: words, passphrase: undefined },
    };

    const meta: KeyringMetaRecord = KeyringMetaRecordSchema.parse({
      id: keyringId,
      type: "hd",
      name: opts.name,
      needsBackup: !opts.skipBackup,
      nextDerivationIndex: 1,
      createdAt: now,
    });

    const record = this.#buildAccountRecord({
      namespace,
      address: canonical,
      keyringId,
      createdAt: now,
      derivationIndex: 0,
      ...(opts?.name !== undefined ? { alias: opts.name } : {}),
    });

    await this.#persistNewKeyring({
      keyringId,
      kind: "hd",
      namespace,
      instance,
      meta,
      accounts: [record],
      payloadEntry,
    });

    return { keyringId, address: canonical };
  }

  async #persistNewKeyring(params: {
    keyringId: string;
    kind: KeyringKind;
    namespace: string;
    instance: HierarchicalDeterministicKeyring | SimpleKeyring;
    meta: KeyringMetaRecord;
    accounts: AccountRecord[];
    payloadEntry: VaultKeyringEntry;
  }) {
    // Persist metadata before updating the encrypted vault payload; this keeps hydration safe if a write fails.
    await this.#options.keyringMetas.upsert(params.meta);
    for (const record of params.accounts) {
      await this.#options.accountsStore.upsert(record);
    }

    this.#keyrings.set(params.keyringId, {
      id: params.keyringId,
      kind: params.kind,
      namespace: params.namespace,
      instance: params.instance,
    });
    this.#keyringMetas.set(params.keyringId, params.meta);
    for (const record of params.accounts) {
      this.#accounts.set(record.accountId, record);
    }
    this.#indexAccounts();

    this.#payload.keyrings = [
      ...this.#payload.keyrings.filter((k) => k.keyringId !== params.keyringId),
      params.payloadEntry,
    ];

    await this.#notifyPayloadUpdated();
  }

  async #removeKeyring(params: { keyringId: string }): Promise<void> {
    const { keyringId } = params;

    // Remove secrets from the vault payload first.
    this.#payload.keyrings = this.#payload.keyrings.filter((entry) => entry.keyringId !== keyringId);
    await this.#notifyPayloadUpdated();

    this.#keyrings.delete(keyringId);
    this.#keyringMetas.delete(keyringId);

    for (const [accountId, record] of Array.from(this.#accounts.entries())) {
      if (record.keyringId === keyringId) {
        this.#accounts.delete(accountId);
      }
    }

    await this.#options.keyringMetas.remove(keyringId);
    await this.#options.accountsStore.removeByKeyringId(keyringId);

    this.#indexAccounts(false);
  }

  async #notifyPayloadUpdated(): Promise<void> {
    const encoded = encodePayload(this.#payload);
    for (const listener of this.#payloadListeners) {
      const payload = encoded.length > 0 ? new Uint8Array(encoded) : null;
      try {
        await listener(payload);
      } catch (error) {
        this.#options.logger?.("keyring: payload listener threw", error);
      } finally {
        if (payload) zeroize(payload);
      }
    }
  }

  async #exportPrivateKeyUnsafe(namespace: string, address: string): Promise<Uint8Array> {
    await this.#waitForHydration();

    const canonical = this.#toCanonicalString(namespace, address);
    const accountId = this.#toAccountId(namespace, canonical);
    const indexed = this.#addressIndex.get(accountId);
    if (!indexed) throw keyringErrors.accountNotFound();

    const runtime = this.#keyrings.get(indexed.keyringId);
    if (!runtime) throw keyringErrors.secretUnavailable();

    return runtime.instance.exportPrivateKey(canonical);
  }

  async #exportPrivateKeyByAccountIdUnsafe(accountId: AccountId): Promise<Uint8Array> {
    await this.#waitForHydration();

    const indexed = this.#addressIndex.get(accountId);
    if (!indexed) throw keyringErrors.accountNotFound();

    const runtime = this.#keyrings.get(indexed.keyringId);
    if (!runtime) throw keyringErrors.secretUnavailable();

    const config = this.#getConfig(indexed.namespace);
    const canonical = config.codec.fromAccountId(accountId);
    const canonicalString = config.codec.toCanonicalString({ chainRef: config.defaultChainRef, canonical });
    return runtime.instance.exportPrivateKey(canonicalString);
  }

  async #setAccountHidden(accountId: AccountId, hidden: boolean): Promise<void> {
    await this.#waitForHydration();

    const record = this.#accounts.get(accountId);
    if (!record) return;
    if (record.derivationIndex === undefined) {
      // Imported accounts (private-key) are not hideable in this UX.
      return;
    }

    const next: AccountRecord = AccountRecordSchema.parse({
      ...record,
      hidden: hidden ? true : undefined,
    });

    await this.#options.accountsStore.upsert(next);
    this.#accounts.set(accountId, next);
    this.#indexAccounts(false);
  }

  #resolveNextDerivationIndex(keyringId: string, meta: KeyringMetaRecord): number {
    const known = Array.from(this.#accounts.values()).filter((a) => a.keyringId === keyringId);
    const maxIndex = Math.max(-1, ...known.map((a) => a.derivationIndex ?? -1));
    const expected = maxIndex + 1;
    const current = meta.nextDerivationIndex ?? 0;
    return Math.max(current, expected);
  }

  #indexAccounts(strict = true) {
    this.#addressIndex.clear();
    for (const record of this.#accounts.values()) {
      const key = record.accountId;
      if (this.#addressIndex.has(key)) {
        if (strict) {
          throw keyringErrors.duplicateAccount();
        }
        this.#options.logger?.(`keyring: duplicate account skipped during hydrate: ${key}`);
        continue;
      }
      this.#addressIndex.set(key, {
        namespace: record.namespace,
        keyringId: record.keyringId,
        accountId: record.accountId,
      });
    }
  }

  #assertNoDuplicate(accountId: AccountId): void {
    if (this.#addressIndex.has(accountId)) {
      throw keyringErrors.duplicateAccount();
    }
  }

  #buildAccountRecord(params: {
    namespace: string;
    address: string;
    keyringId: string;
    createdAt: number;
    alias?: string;
    derivationIndex?: number;
  }): AccountRecord {
    const config = this.#getConfig(params.namespace);
    const canonical = this.#toCanonicalAddress(params.namespace, params.address);
    if (canonical.bytes.length !== 20) throw keyringErrors.invalidAddress();

    const payloadHex = bytesToHex(canonical.bytes);
    const accountId = AccountIdSchema.parse(config.codec.toAccountId(canonical));

    return AccountRecordSchema.parse({
      accountId,
      namespace: params.namespace,
      payloadHex,
      keyringId: params.keyringId,
      derivationIndex: params.derivationIndex,
      alias: params.alias,
      createdAt: params.createdAt,
    });
  }

  #toCanonicalAddress(namespace: string, address: string) {
    const config = this.#getConfig(namespace);
    try {
      return config.codec.toCanonicalAddress({ chainRef: config.defaultChainRef, value: address });
    } catch {
      throw keyringErrors.invalidAddress();
    }
  }

  #toCanonicalString(namespace: string, address: string): string {
    const config = this.#getConfig(namespace);
    const canonical = this.#toCanonicalAddress(namespace, address);
    return config.codec.toCanonicalString({ chainRef: config.defaultChainRef, canonical });
  }

  #toAccountId(namespace: string, address: string): AccountId {
    const canonical = this.#toCanonicalAddress(namespace, address);
    const config = this.#getConfig(namespace);
    return AccountIdSchema.parse(config.codec.toAccountId(canonical));
  }

  #defaultNamespace(): string {
    const [first] = this.#options.namespaces;
    if (!first) throw new Error("No keyring namespace configured");
    return first.namespace;
  }

  #getConfig(namespace: string): NamespaceConfig {
    const config = this.#namespacesConfig.get(namespace);
    if (!config) throw new Error(`Namespace "${namespace}" is not supported`);
    return config;
  }
}
