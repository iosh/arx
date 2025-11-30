import { generateMnemonic as BIP39Generate, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import type {
  AccountController,
  MultiNamespaceAccountsState,
  NamespaceAccountsState,
} from "../../controllers/account/types.js";
import type { UnlockController, UnlockLockedPayload, UnlockUnlockedPayload } from "../../controllers/unlock/types.js";
import { keyringErrors } from "../../errors/keyring.js";
import { vaultErrors } from "../../errors/vault.js";
import type { KeyringKind, NamespaceConfig } from "../../keyring/namespace.js";
import { getAddressKey } from "../../keyring/namespace.js";
import type { HierarchicalDeterministicKeyring, SimpleKeyring } from "../../keyring/types.js";
import type { AccountMeta, KeyringMeta, VaultKeyringEntry } from "../../storage/keyringSchemas.js";
import { KEYRING_VAULT_ENTRY_VERSION, VaultKeyringPayloadSchema } from "../../storage/keyringSchemas.js";
import type { KeyringStorePort } from "../../storage/keyringStore.js";
import type { VaultService } from "../../vault/types.js";
import { zeroize } from "../../vault/utils.js";

type KeyringServiceOptions = {
  vault: Pick<VaultService, "exportKey" | "isUnlocked" | "verifyPassword">;
  unlock: Pick<UnlockController, "onUnlocked" | "onLocked" | "isUnlocked">;
  accounts: Pick<AccountController, "getState" | "replaceState">;
  keyringStore: KeyringStorePort;
  namespaces: NamespaceConfig[];
  logger?: (message: string, error?: unknown) => void;
};

type RuntimeKeyring = {
  id: string;
  kind: KeyringKind;
  namespace: string;
  instance: HierarchicalDeterministicKeyring | SimpleKeyring;
};

type Payload = { keyrings: VaultKeyringEntry[] };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const encodePayload = (payload: Payload): Uint8Array => encoder.encode(JSON.stringify(payload));
const decodePayload = (bytes: Uint8Array | null, logger?: (m: string, e?: unknown) => void): Payload => {
  if (!bytes || bytes.length === 0) return { keyrings: [] };
  try {
    const parsed = JSON.parse(decoder.decode(bytes)) as unknown;
    return VaultKeyringPayloadSchema.parse(parsed);
  } catch (error) {
    logger?.("keyring: failed to decode vault payload", error);
    return { keyrings: [] };
  } finally {
    if (bytes) zeroize(bytes);
  }
};

export class KeyringService {
  #options: KeyringServiceOptions;
  #namespacesConfig: Map<string, NamespaceConfig>;
  #keyrings = new Map<string, RuntimeKeyring>();
  #keyringMetas = new Map<string, KeyringMeta>();
  #accountMetas = new Map<string, AccountMeta>();
  #payload: Payload = { keyrings: [] };
  #subscriptions: Array<() => void> = [];
  #payloadListeners = new Set<(payload: Uint8Array | null) => void>();
  #addressIndex = new Map<string, { namespace: string; keyringId: string }>();
  #initializing = false;
  #hydrationPromise: Promise<void> | null = null;

  constructor(options: KeyringServiceOptions) {
    this.#options = options;
    this.#namespacesConfig = new Map(options.namespaces.map((ns) => [ns.namespace, ns]));
  }

  async attach() {
    if (this.#subscriptions.length > 0) return;
    this.#subscriptions.push(this.#options.unlock.onUnlocked((payload) => this.#handleUnlocked(payload)));
    this.#subscriptions.push(this.#options.unlock.onLocked((payload) => this.#handleLocked(payload)));
    if (this.#options.unlock.isUnlocked()) {
      await this.#hydrate();
    }
  }

  detach() {
    this.#subscriptions.splice(0).forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (error) {
        this.#options.logger?.("keyring: failed to remove unlock subscription", error);
      }
    });
    this.#subscriptions = [];
    this.#clearRuntime();
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
    return BIP39Generate(wordlist, wordCount);
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
    this.#handleLocked({ at: Date.now(), reason: "manual" });
  }

  // ----- private helpers -----

  async #waitForHydration(): Promise<void> {
    const hydration = this.#hydrationPromise;
    if (!this.#initializing || !hydration) return;

    const timeoutMs = 10_000;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        hydration,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Hydration timeout")), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
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
      if ((error as { code?: string }).code === "ARX_VAULT_INVALID_PASSWORD") {
        throw vaultErrors.invalidPassword();
      }
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

  async #hydrate() {
    if (this.#initializing) return;
    this.#initializing = true;

    let resolveHydration!: () => void;
    this.#hydrationPromise = new Promise<void>((resolve) => {
      resolveHydration = resolve;
    });

    try {
      if (!this.#options.vault.isUnlocked()) {
        this.#clearRuntime();
        return;
      }
      const [metas, accounts] = await Promise.all([
        this.#options.keyringStore.getKeyringMetas(),
        this.#options.keyringStore.getAccountMetas(),
      ]);

      this.#keyringMetas = new Map(metas.map((m) => [m.id, m]));
      this.#accountMetas = new Map(accounts.map((a) => [a.address, a]));

      const payload = decodePayload(this.#options.vault.exportKey(), this.#options.logger);
      this.#payload = payload;
      this.#keyrings.clear();

      const isHdPayload = (value: unknown): value is { mnemonic: string[]; passphrase?: string } =>
        !!value && typeof value === "object" && Array.isArray((value as { mnemonic?: unknown }).mnemonic);

      const isPrivateKeyPayload = (value: unknown): value is { privateKey: string } =>
        !!value && typeof value === "object" && typeof (value as { privateKey?: unknown }).privateKey === "string";
      for (const entry of payload.keyrings) {
        const namespace = entry.namespace ?? this.#defaultNamespace();
        const config = this.#getConfig(namespace);
        const factory =
          entry.type === "hd"
            ? config.factories.hd
            : entry.type === "private-key"
              ? config.factories["private-key"]
              : undefined;
        if (!factory) continue;

        try {
          const instance = factory();
          if (entry.type === "hd") {
            if (!isHdPayload(entry.payload)) throw keyringErrors.secretUnavailable();
            const hd = instance as HierarchicalDeterministicKeyring;
            const payload = entry.payload;
            hd.loadFromMnemonic(
              payload.mnemonic.join(" "),
              payload.passphrase ? { passphrase: payload.passphrase } : undefined,
            );

            const accs = accounts.filter((a) => a.keyringId === entry.keyringId);
            const derived = accs
              .filter((a) => a.derivationIndex !== undefined)
              .sort((a, b) => (a.derivationIndex ?? 0) - (b.derivationIndex ?? 0));

            for (const meta of derived) {
              const derivedAccount = hd.deriveAccount(meta.derivationIndex ?? 0);
              if (config.normalizeAddress(derivedAccount.address) !== meta.address) {
                throw keyringErrors.secretUnavailable();
              }
            }
          } else {
            if (!isPrivateKeyPayload(entry.payload)) throw keyringErrors.secretUnavailable();
            const simple = instance as SimpleKeyring;
            const payload = entry.payload;
            simple.loadFromPrivateKey(payload.privateKey);
          }

          this.#keyrings.set(entry.keyringId, { id: entry.keyringId, kind: entry.type, namespace, instance });
        } catch (error) {
          this.#options.logger?.(`keyring: failed to hydrate keyring ${entry.keyringId}`, error);
        }
      }

      await this.#reconcileDerivedCounts();
      this.#indexAccounts(false);
      this.#syncAccountsState();
      this.#notifyPayloadUpdated();
    } finally {
      this.#initializing = false;
      resolveHydration();
      this.#hydrationPromise = null;
    }
  }
  #handleUnlocked(_payload: UnlockUnlockedPayload): void {
    void this.#hydrate().catch((error) => this.#options.logger?.("keyring: hydrate failed", error));
  }

  #handleLocked(_payload: UnlockLockedPayload): void {
    this.#clearRuntime();
    this.#syncAccountsState();
    this.#notifyPayloadUpdated();
  }

  #clearRuntime() {
    for (const runtime of this.#keyrings.values()) {
      try {
        runtime.instance.clear();
      } catch (error) {
        this.#options.logger?.("keyring: failed to clear runtime keyring", error);
      }
    }
    this.#keyrings.clear();
    this.#keyringMetas.clear();
    this.#accountMetas.clear();
    this.#addressIndex.clear();
    this.#payload = { keyrings: [] };
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
  // Ensures hd keyring meta.derivedCount reflects (max derivationIndex + 1) of stored accounts.
  // Prevents index reuse after partial rollback or manual edits.
  async #reconcileDerivedCounts() {
    let patched = false;
    for (const [keyringId, meta] of this.#keyringMetas) {
      if (meta.type !== "hd") continue;
      const accounts = this.getAccounts(true).filter((a) => a.keyringId === keyringId);
      const maxIndex = Math.max(-1, ...accounts.map((a) => a.derivationIndex ?? -1));
      const expected = maxIndex + 1;
      if (meta.derivedCount === undefined || meta.derivedCount < expected) {
        this.#options.logger?.(`keyring: derivedCount mismatch, fixing ${meta.derivedCount ?? "unset"} -> ${expected}`);
        this.#keyringMetas.set(keyringId, { ...meta, derivedCount: expected });
        patched = true;
      }
    }
    if (patched) {
      await this.#options.keyringStore.putKeyringMetas(this.getKeyrings());
    }
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
