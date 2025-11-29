import { z } from "zod";
import type {
  AccountController,
  ActivePointer,
  MultiNamespaceAccountsState,
  NamespaceAccountsState,
} from "../../controllers/account/types.js";
import type { UnlockController, UnlockLockedPayload, UnlockUnlockedPayload } from "../../controllers/unlock/types.js";
import { keyringErrors } from "../../errors/keyring.js";
import type { KeyringKind, NamespaceConfig } from "../../keyring/namespace.js";
import { getAddressKey } from "../../keyring/namespace.js";
import type {
  HierarchicalDeterministicKeyring,
  HierarchicalDeterministicKeyringSnapshot,
  KeyringAccount,
  KeyringSnapshot,
  SimpleKeyring,
  SimpleKeyringSnapshot,
} from "../../keyring/types.js";
import type { VaultService } from "../../vault/types.js";
import { zeroize } from "../../vault/utils.js";

const KEYRING_ENVELOPE_VERSION = 1;

const KeyringAccountSchema = z.strictObject({
  address: z.string().min(1),
  derivationPath: z.string().nullable(),
  derivationIndex: z.number().int().nullable(),
  source: z.union([z.literal("derived"), z.literal("imported")]),
});

const HierarchicalSnapshotSchema = z.strictObject({
  type: z.literal("hierarchical"),
  accounts: z.array(KeyringAccountSchema),
  nextDerivationIndex: z.number().int().min(0),
});

const SimpleSnapshotSchema = z.strictObject({
  type: z.literal("simple"),
  account: KeyringAccountSchema.nullable(),
});

const KeyringSnapshotSchema = z.union([HierarchicalSnapshotSchema, SimpleSnapshotSchema]);

const HdSecretSchema = z.strictObject({
  type: z.literal("hd"),
  mnemonic: z.string().min(1),
  passphrase: z.string().optional(),
});

const PrivateKeySecretSchema = z.strictObject({
  type: z.literal("private-key"),
  privateKey: z.string().min(1),
});

const KeyringSecretSchema = z.discriminatedUnion("type", [HdSecretSchema, PrivateKeySecretSchema]);

const KeyringInstanceSchema = z.strictObject({
  id: z.string().uuid(),
  kind: z.enum(["hd", "private-key"]),
  createdAt: z.number(),
  secret: KeyringSecretSchema,
  snapshot: KeyringSnapshotSchema.optional(),
});

const NamespaceEnvelopeSchema = z.strictObject({
  keyrings: z.array(KeyringInstanceSchema),
});

const KeyringEnvelopeSchema = z.strictObject({
  version: z.literal(KEYRING_ENVELOPE_VERSION),
  namespaces: z.record(z.string(), NamespaceEnvelopeSchema),
});

type KeyringInstanceEnvelope = z.infer<typeof KeyringInstanceSchema>;
type NamespaceEnvelope = z.infer<typeof NamespaceEnvelopeSchema>;
type KeyringEnvelope = z.infer<typeof KeyringEnvelopeSchema>;

type RuntimeKeyring = {
  id: string;
  kind: KeyringKind;
  instance: HierarchicalDeterministicKeyring | SimpleKeyring;
};

type NamespaceRuntime = {
  config: NamespaceConfig;
  keyrings: Map<string, RuntimeKeyring>;
  envelope: NamespaceEnvelope;
};

type KeyringServiceOptions = {
  vault: Pick<VaultService, "exportKey" | "getStatus" | "isUnlocked">;
  unlock: Pick<UnlockController, "onUnlocked" | "onLocked" | "isUnlocked">;
  accounts: Pick<AccountController, "getState" | "replaceState">;
  namespaces: NamespaceConfig[];
  logger?: (message: string, error?: unknown) => void;
};

type EnvelopeListener = (payload: Uint8Array | null) => void;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const createEmptyEnvelope = (): KeyringEnvelope => ({
  version: KEYRING_ENVELOPE_VERSION,
  namespaces: {},
});

const decodeEnvelope = (
  secret: Uint8Array,
  logger?: (message: string, error?: unknown) => void,
): KeyringEnvelope | null => {
  if (secret.length === 0) {
    return null;
  }
  try {
    const decoded = decoder.decode(secret);
    const trimmed = decoded.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = JSON.parse(trimmed) as unknown;
    return KeyringEnvelopeSchema.parse(parsed);
  } catch (error) {
    logger?.("keyring: failed to decode envelope", error);
    return null;
  } finally {
    zeroize(secret);
  }
};

const encodeEnvelope = (envelope: KeyringEnvelope): Uint8Array => {
  const payload = JSON.stringify(envelope);
  return encoder.encode(payload);
};

const normalizeSnapshot = (snapshot: KeyringSnapshot): KeyringSnapshot => {
  if (snapshot.type === "hierarchical") {
    return {
      type: "hierarchical",
      accounts: snapshot.accounts.filter((account) => account.source === "derived").map((account) => ({ ...account })),
      nextDerivationIndex: snapshot.nextDerivationIndex,
    };
  }
  return {
    type: "simple",
    account: snapshot.account ? { ...snapshot.account } : null,
  };
};

export class KeyringService {
  #options: KeyringServiceOptions;
  #namespacesConfig: Map<string, NamespaceConfig>;
  #namespaces = new Map<string, NamespaceRuntime>();
  #subscriptions: Array<() => void> = [];
  #envelopeListeners = new Set<EnvelopeListener>();
  #envelope: KeyringEnvelope | null = null;
  #initializing = false;
  // dedupe index: namespace+normalizedAddress -> owner
  #addressIndex = new Map<string, { namespace: string; keyringId: string; address: string; kind: KeyringKind }>();

  constructor(options: KeyringServiceOptions) {
    this.#options = options;
    this.#namespacesConfig = new Map(options.namespaces.map((ns) => [ns.namespace, ns]));
  }

  async attach() {
    if (this.#subscriptions.length > 0) {
      return;
    }
    this.#subscriptions.push(this.#options.unlock.onUnlocked((payload) => this.#handleUnlocked(payload)));
    this.#subscriptions.push(this.#options.unlock.onLocked((payload) => this.#handleLocked(payload)));
    if (this.#options.unlock.isUnlocked()) {
      await this.#hydrateFromVault();
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
    this.#clearNamespaces();
  }

  onEnvelopeUpdated(handler: EnvelopeListener): () => void {
    this.#envelopeListeners.add(handler);
    return () => {
      this.#envelopeListeners.delete(handler);
    };
  }

  getEnvelope(): Uint8Array | null {
    if (!this.#envelope) {
      return null;
    }
    return encodeEnvelope(this.#envelope);
  }

  getNamespaces(): NamespaceConfig[] {
    return Array.from(this.#namespacesConfig.values());
  }

  getAccounts(namespace: string): KeyringAccount[] {
    const runtime = this.#namespaces.get(namespace);
    if (!runtime) return [];
    const accounts: KeyringAccount[] = [];
    for (const { instance } of runtime.keyrings.values()) {
      accounts.push(...instance.getAccounts().map((a) => ({ ...a })));
    }
    return accounts;
  }

  listKeyrings(
    namespace?: string,
  ): Array<{ namespace: string; id: string; kind: KeyringKind; accounts: KeyringAccount[] }> {
    const entries: Array<{ namespace: string; id: string; kind: KeyringKind; accounts: KeyringAccount[] }> = [];
    const sources = namespace
      ? ([[namespace, this.#namespaces.get(namespace)]] as Array<[string, NamespaceRuntime | undefined]>)
      : Array.from(this.#namespaces.entries());

    for (const [ns, runtime] of sources) {
      if (!runtime) continue;
      for (const keyring of runtime.keyrings.values()) {
        entries.push({
          namespace: ns,
          id: keyring.id,
          kind: keyring.kind,
          accounts: keyring.instance.getAccounts().map((a) => ({ ...a })),
        });
      }
    }
    return entries;
  }

  hasAccount(namespace: string, address: string): boolean {
    const key = this.#toKey(namespace, address);
    return this.#addressIndex.has(key);
  }

  exportPrivateKey(namespace: string, keyringId: string, address: string): Uint8Array {
    const runtime = this.#getRuntimeKeyring(namespace, keyringId);
    return runtime.instance.exportPrivateKey(address);
  }

  createHdKeyring(
    namespace: string,
    params: { mnemonic: string; passphrase?: string },
  ): { keyringId: string; accounts: KeyringAccount[] } {
    const config = this.#getConfig(namespace);
    const id = crypto.randomUUID();
    const keyring = config.factories.hd?.();
    if (!keyring) {
      throw new Error(`Namespace "${namespace}" does not support hd keyring`);
    }

    keyring.loadFromMnemonic(params.mnemonic, params.passphrase ? { passphrase: params.passphrase } : undefined);
    if (keyring.getAccounts().length === 0) {
      keyring.deriveNextAccount();
    }

    const runtime = this.#ensureNamespaceRuntime(namespace);
    this.#registerKeyring(
      namespace,
      runtime,
      {
        id,
        kind: "hd",
        createdAt: Date.now(),
        secret: {
          type: "hd",
          mnemonic: params.mnemonic,
          ...(params.passphrase ? { passphrase: params.passphrase } : {}),
        },
        snapshot: normalizeSnapshot(keyring.toSnapshot()),
      },
      keyring,
    );

    const accounts = keyring.getAccounts().map((a) => ({ ...a }));
    this.#syncAccountsState();
    this.#notifyEnvelopeUpdated();
    return { keyringId: id, accounts };
  }

  importPrivateKey(
    namespace: string,
    params: { privateKey: string | Uint8Array },
  ): { keyringId: string; account: KeyringAccount } {
    const config = this.#getConfig(namespace);
    const keyring = config.factories["private-key"]?.();
    if (!keyring) {
      throw new Error(`Namespace "${namespace}" does not support private-key keyring`);
    }

    keyring.loadFromPrivateKey(params.privateKey);
    const [account] = keyring.getAccounts();
    if (!account) {
      throw keyringErrors.secretUnavailable();
    }

    this.#assertNoDuplicate(namespace, account.address);

    const runtime = this.#ensureNamespaceRuntime(namespace);
    const id = crypto.randomUUID();
    this.#registerKeyring(
      namespace,
      runtime,
      {
        id,
        kind: "private-key",
        createdAt: Date.now(),
        secret: {
          type: "private-key",
          privateKey:
            typeof params.privateKey === "string" ? params.privateKey : Buffer.from(params.privateKey).toString("hex"),
        },
        snapshot: normalizeSnapshot(keyring.toSnapshot()),
      },
      keyring,
    );

    this.#syncAccountsState();
    this.#notifyEnvelopeUpdated();
    return { keyringId: id, account: { ...account } };
  }

  deriveNextAccount(namespace: string, keyringId: string): KeyringAccount {
    const runtime = this.#getRuntimeKeyring(namespace, keyringId);
    if (runtime.kind !== "hd") {
      throw keyringErrors.indexOutOfRange();
    }
    const derived = (runtime.instance as HierarchicalDeterministicKeyring).deriveNextAccount();
    this.#assertNoDuplicate(namespace, derived.address);

    this.#updateKeyringSnapshot(namespace, keyringId, runtime);
    this.#syncAccountsState();
    this.#notifyEnvelopeUpdated();
    return { ...derived };
  }

  removeAccount(namespace: string, keyringId: string, address: string): void {
    const runtime = this.#getRuntimeKeyring(namespace, keyringId);
    runtime.instance.removeAccount(address);
    this.#removeFromIndex(namespace, address);

    if (runtime.kind === "private-key") {
      if (runtime.instance.getAccounts().length === 0) {
        this.#removeKeyring(namespace, keyringId);
      } else {
        this.#updateKeyringSnapshot(namespace, keyringId, runtime);
      }
    } else {
      this.#updateKeyringSnapshot(namespace, keyringId, runtime);
    }

    this.#syncAccountsState();
    this.#notifyEnvelopeUpdated();
  }

  importAccount(namespace: string, keyringId: string, privateKey: string | Uint8Array): KeyringAccount {
    const runtime = this.#getRuntimeKeyring(namespace, keyringId);
    if (runtime.kind !== "hd") {
      throw keyringErrors.indexOutOfRange();
    }

    const account = (runtime.instance as HierarchicalDeterministicKeyring).importAccount(privateKey);
    this.#assertNoDuplicate(namespace, account.address);
    this.#updateKeyringSnapshot(namespace, keyringId, runtime);
    this.#syncAccountsState();
    this.#notifyEnvelopeUpdated();
    return { ...account };
  }

  hasNamespace(namespace: string): boolean {
    return this.#namespacesConfig.has(namespace);
  }

  #getConfig(namespace: string): NamespaceConfig {
    const config = this.#namespacesConfig.get(namespace);
    if (!config) {
      throw new Error(`Namespace "${namespace}" is not supported`);
    }
    return config;
  }

  #toKey(namespace: string, address: string): string {
    const config = this.#getConfig(namespace);
    return getAddressKey(namespace, address, config.normalizeAddress);
  }

  #ensureNamespaceRuntime(namespace: string): NamespaceRuntime {
    const existing = this.#namespaces.get(namespace);
    if (existing) return existing;

    const config = this.#getConfig(namespace);
    const envelope = this.#ensureNamespaceEnvelope(namespace);
    const runtime: NamespaceRuntime = { config, keyrings: new Map(), envelope };
    this.#namespaces.set(namespace, runtime);
    return runtime;
  }

  #ensureNamespaceEnvelope(namespace: string): NamespaceEnvelope {
    const current = this.#ensureEnvelope();
    if (!current.namespaces[namespace]) {
      current.namespaces[namespace] = { keyrings: [] };
    }
    return current.namespaces[namespace]!;
  }

  #ensureEnvelope(): KeyringEnvelope {
    if (!this.#envelope) {
      this.#envelope = createEmptyEnvelope();
    }
    return this.#envelope;
  }

  #getRuntimeKeyring(namespace: string, keyringId: string): RuntimeKeyring {
    const runtime = this.#namespaces.get(namespace);
    if (!runtime) {
      throw new Error(`Namespace "${namespace}" is not initialized`);
    }
    const keyring = runtime.keyrings.get(keyringId);
    if (!keyring) {
      throw new Error(`Keyring "${keyringId}" is not initialized`);
    }
    return keyring;
  }

  #registerKeyring(
    namespace: string,
    runtime: NamespaceRuntime,
    envelopeEntry: KeyringInstanceEnvelope,
    instance: HierarchicalDeterministicKeyring | SimpleKeyring,
  ): void {
    const sanitizedSnapshot = envelopeEntry.snapshot ? normalizeSnapshot(envelopeEntry.snapshot) : undefined;
    const sanitizedEntry: KeyringInstanceEnvelope = {
      ...envelopeEntry,
      snapshot: sanitizedSnapshot,
    };

    runtime.keyrings.set(envelopeEntry.id, {
      id: envelopeEntry.id,
      kind: envelopeEntry.kind,
      instance,
    });

    runtime.envelope.keyrings = runtime.envelope.keyrings.filter((item) => item.id !== envelopeEntry.id);
    runtime.envelope.keyrings.push(sanitizedEntry);
    this.#indexAccounts(namespace, envelopeEntry.id, envelopeEntry.kind, instance, runtime.config.normalizeAddress);
  }

  #removeKeyring(namespace: string, keyringId: string): void {
    const runtime = this.#namespaces.get(namespace);
    if (!runtime) return;

    runtime.keyrings.delete(keyringId);
    runtime.envelope.keyrings = runtime.envelope.keyrings.filter((item) => item.id !== keyringId);
    this.#rebuildIndex();
  }

  #updateKeyringSnapshot(namespace: string, keyringId: string, runtime: RuntimeKeyring): void {
    const nsRuntime = this.#namespaces.get(namespace);
    if (!nsRuntime) return;

    const snapshot = normalizeSnapshot(runtime.instance.toSnapshot() as KeyringSnapshot);
    const existing = nsRuntime.envelope.keyrings.find((entry) => entry.id === keyringId);
    if (existing) {
      existing.snapshot = snapshot;
    } else {
      nsRuntime.envelope.keyrings.push({
        id: keyringId,
        kind: runtime.kind,
        createdAt: Date.now(),
        secret:
          runtime.kind === "hd"
            ? { type: "hd", mnemonic: "", passphrase: undefined }
            : { type: "private-key", privateKey: "" },
        snapshot,
      });
    }
    this.#rebuildIndex();
  }

  #indexAccounts(
    namespace: string,
    keyringId: string,
    kind: KeyringKind,
    instance: HierarchicalDeterministicKeyring | SimpleKeyring,
    normalize: (value: string) => string,
  ) {
    for (const account of instance.getAccounts()) {
      const key = `${namespace}:${normalize(account.address)}`;
      if (this.#addressIndex.has(key)) {
        throw keyringErrors.duplicateAccount();
      }
      this.#addressIndex.set(key, { namespace, keyringId, address: normalize(account.address), kind });
    }
  }

  #removeFromIndex(namespace: string, address: string) {
    const key = this.#toKey(namespace, address);
    this.#addressIndex.delete(key);
  }

  #rebuildIndex() {
    this.#addressIndex.clear();
    for (const [namespace, runtime] of this.#namespaces.entries()) {
      const normalize = runtime.config.normalizeAddress;
      for (const item of runtime.keyrings.values()) {
        for (const account of item.instance.getAccounts()) {
          const key = `${namespace}:${normalize(account.address)}`;
          if (this.#addressIndex.has(key)) {
            throw keyringErrors.duplicateAccount();
          }
          this.#addressIndex.set(key, {
            namespace,
            keyringId: item.id,
            address: normalize(account.address),
            kind: item.kind,
          });
        }
      }
    }
  }

  #assertNoDuplicate(namespace: string, address: string) {
    const key = this.#toKey(namespace, address);
    if (this.#addressIndex.has(key)) {
      throw keyringErrors.duplicateAccount();
    }
  }

  async #hydrateFromVault(): Promise<void> {
    if (this.#initializing) {
      return;
    }
    this.#initializing = true;
    try {
      if (!this.#options.vault.isUnlocked()) {
        this.#clearNamespaces();
        this.#envelope = null;
        return;
      }

      let exported: Uint8Array;
      try {
        exported = this.#options.vault.exportKey();
      } catch (error) {
        this.#options.logger?.("keyring: vault refused exportKey()", error);
        this.#clearNamespaces();
        this.#envelope = null;
        this.#notifyEnvelopeUpdated();
        return;
      }

      const decoded = decodeEnvelope(exported, this.#options.logger) ?? createEmptyEnvelope();
      this.#envelope = decoded;
      this.#initializeNamespaces(decoded);
      this.#syncAccountsState();
      this.#notifyEnvelopeUpdated();
    } finally {
      this.#initializing = false;
    }
  }

  #initializeNamespaces(envelope: KeyringEnvelope): void {
    this.#clearNamespaces();
    for (const [namespace, payload] of Object.entries(envelope.namespaces)) {
      const config = this.#namespacesConfig.get(namespace);
      if (!config) {
        this.#options.logger?.(`keyring: skipped unsupported namespace "${namespace}"`, undefined);
        continue;
      }

      // Ensure namespace envelope exists in this.#envelope
      if (!this.#envelope!.namespaces[namespace]) {
        this.#envelope!.namespaces[namespace] = { keyrings: [] };
      }
      const namespaceEnvelope = this.#envelope!.namespaces[namespace]!;

      const runtime: NamespaceRuntime = { config, keyrings: new Map(), envelope: namespaceEnvelope };
      for (const entry of payload.keyrings) {
        const factory =
          entry.kind === "hd"
            ? config.factories.hd
            : entry.kind === "private-key"
              ? config.factories["private-key"]
              : undefined;
        if (!factory) {
          this.#options.logger?.(`keyring: no factory for kind "${entry.kind}" in namespace "${namespace}"`, undefined);
          continue;
        }
        try {
          const instance = factory();
          if (entry.secret.type === "hd") {
            (instance as HierarchicalDeterministicKeyring).loadFromMnemonic(
              entry.secret.mnemonic,
              entry.secret.passphrase ? { passphrase: entry.secret.passphrase } : undefined,
            );
          } else {
            (instance as SimpleKeyring).loadFromPrivateKey(entry.secret.privateKey);
          }

          if (entry.snapshot) {
            const snapshot = normalizeSnapshot(entry.snapshot);
            if (snapshot.type === "hierarchical") {
              (instance as HierarchicalDeterministicKeyring).hydrate(
                snapshot as HierarchicalDeterministicKeyringSnapshot,
              );
            } else {
              (instance as SimpleKeyring).hydrate(snapshot as SimpleKeyringSnapshot);
            }
          }
          runtime.keyrings.set(entry.id, { id: entry.id, kind: entry.kind, instance });

          // Only push if not already exists
          const existingIndex = namespaceEnvelope.keyrings.findIndex((k) => k.id === entry.id);
          if (existingIndex === -1) {
            namespaceEnvelope.keyrings.push({
              ...entry,
              snapshot: entry.snapshot ? normalizeSnapshot(entry.snapshot) : undefined,
            });
          }
        } catch (error) {
          this.#options.logger?.(`keyring: failed to initialize keyring "${entry.id}"`, error);
        }
      }
      this.#namespaces.set(namespace, runtime);
    }
    this.#rebuildIndex();
  }

  #buildNamespacesState(current: MultiNamespaceAccountsState<string>): Record<string, NamespaceAccountsState<string>> {
    const result: Record<string, NamespaceAccountsState<string>> = {};

    for (const [namespace, runtime] of this.#namespaces.entries()) {
      const normalize = runtime.config.normalizeAddress;
      const canonicalAccounts = Array.from(runtime.keyrings.values()).flatMap((kr) =>
        kr.instance.getAccounts().map((account) => normalize(account.address)),
      );
      const previous = current.namespaces[namespace] ?? { all: [], primary: null };
      const primary = this.#resolvePrimaryAddress(canonicalAccounts, previous.primary);
      result[namespace] = { all: canonicalAccounts, primary };
    }

    return result;
  }

  #resolvePrimaryAddress(accounts: string[], currentPrimary: string | null): string | null {
    if (currentPrimary && accounts.includes(currentPrimary)) {
      return currentPrimary;
    }
    return accounts[0] ?? null;
  }

  #resolveActivePointer(
    current: MultiNamespaceAccountsState<string>,
    nextNamespaces: Record<string, NamespaceAccountsState<string>>,
  ): ActivePointer<string> | null {
    if (!current.active) {
      return null;
    }

    if (!nextNamespaces[current.active.namespace]) {
      return null;
    }

    const primary = nextNamespaces[current.active.namespace]?.primary;
    if (!primary) {
      return null;
    }

    const accounts = nextNamespaces[current.active.namespace]?.all ?? [];
    if (accounts.includes(current.active.address ?? "")) {
      return { ...current.active };
    }

    return { ...current.active, address: primary };
  }

  #syncAccountsState() {
    const current = this.#options.accounts.getState();
    const nextNamespaces = this.#buildNamespacesState(current);
    const nextActive = this.#resolveActivePointer(current, nextNamespaces);

    this.#options.accounts.replaceState({
      namespaces: nextNamespaces,
      active: nextActive,
    });
  }

  #handleUnlocked(_payload: UnlockUnlockedPayload): void {
    void this.#hydrateFromVault().catch((error) => {
      this.#options.logger?.("keyring: failed to hydrate after unlock", error);
    });
  }

  #handleLocked(_payload: UnlockLockedPayload): void {
    this.#clearNamespaces();
    this.#envelope = null;
    this.#addressIndex.clear();
    this.#syncAccountsState();
    this.#notifyEnvelopeUpdated();
  }

  #notifyEnvelopeUpdated(): void {
    const encoded = this.getEnvelope();
    for (const listener of this.#envelopeListeners) {
      try {
        listener(encoded ? new Uint8Array(encoded) : null);
      } catch (error) {
        this.#options.logger?.("keyring: envelope listener threw", error);
      }
    }
  }

  #clearNamespaces(): void {
    for (const runtime of this.#namespaces.values()) {
      for (const keyring of runtime.keyrings.values()) {
        try {
          keyring.instance.clear();
        } catch (error) {
          this.#options.logger?.("keyring: failed to clear runtime keyring", error);
        }
      }
    }
    this.#namespaces.clear();
    this.#addressIndex.clear();
  }
}
