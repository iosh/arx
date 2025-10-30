import { z } from "zod";
import type {
  AccountController,
  ActivePointer,
  MultiNamespaceAccountsState,
  NamespaceAccountsState,
} from "../../controllers/account/types.js";
import type { UnlockController, UnlockLockedPayload, UnlockUnlockedPayload } from "../../controllers/unlock/types.js";
import type {
  HierarchicalDeterministicKeyring,
  HierarchicalDeterministicKeyringSnapshot,
  KeyringAccount,
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

const HierarchicalNamespaceEnvelopeSchema = z.strictObject({
  type: z.literal("hierarchical"),
  mnemonic: z.string().min(1),
  passphrase: z.string().optional(),
  snapshot: HierarchicalSnapshotSchema.optional(),
});

const KeyringEnvelopeSchema = z.strictObject({
  version: z.literal(KEYRING_ENVELOPE_VERSION),
  namespaces: z.record(z.string(), HierarchicalNamespaceEnvelopeSchema),
});

type HierarchicalNamespaceEnvelope = z.infer<typeof HierarchicalNamespaceEnvelopeSchema>;
type KeyringEnvelope = z.infer<typeof KeyringEnvelopeSchema>;
type NamespaceKeyringFactory<TAccount extends KeyringAccount = KeyringAccount> =
  () => HierarchicalDeterministicKeyring<TAccount>;

type NamespaceDescriptor<TAccount extends KeyringAccount = KeyringAccount> = {
  createKeyring: NamespaceKeyringFactory<TAccount>;
};

type NamespaceRuntime = {
  keyring: HierarchicalDeterministicKeyring<KeyringAccount>;
  descriptor: NamespaceDescriptor;
  envelope: HierarchicalNamespaceEnvelope;
};

type KeyringServiceOptions = {
  vault: Pick<VaultService, "exportKey" | "getStatus" | "isUnlocked">;
  unlock: Pick<UnlockController, "onUnlocked" | "onLocked" | "isUnlocked">;
  accounts: Pick<AccountController, "getState" | "replaceState">;
  namespaces: Record<string, NamespaceDescriptor>;
  logger?: (message: string, error?: unknown) => void;
};

type EnvelopeListener = (payload: Uint8Array | null) => void;

// Drop imported accounts because hydrate() can only rebuild derived entries.
const toStorableSnapshot = (
  snapshot: HierarchicalDeterministicKeyringSnapshot<KeyringAccount>,
): HierarchicalDeterministicKeyringSnapshot<KeyringAccount> => ({
  type: "hierarchical",
  accounts: snapshot.accounts.filter((account) => account.source === "derived").map((account) => ({ ...account })),
  nextDerivationIndex: snapshot.nextDerivationIndex,
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const createEmptyEnvelope = (): KeyringEnvelope => ({
  version: KEYRING_ENVELOPE_VERSION,
  namespaces: {},
});

const decodeEnvelope = (secret: Uint8Array): KeyringEnvelope | null => {
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
    return null;
  } finally {
    zeroize(secret);
  }
};

const encodeEnvelope = (envelope: KeyringEnvelope): Uint8Array => {
  const payload = JSON.stringify(envelope);
  return encoder.encode(payload);
};

export class KeyringService {
  #options: KeyringServiceOptions;
  #envelope: KeyringEnvelope | null = null;
  #namespaces = new Map<string, NamespaceRuntime>();
  #subscriptions: Array<() => void> = [];
  #envelopeListeners = new Set<EnvelopeListener>();
  #initializing = false;

  constructor(options: KeyringServiceOptions) {
    this.#options = options;
  }

  attach() {
    if (this.#subscriptions.length > 0) {
      return;
    }
    this.#subscriptions.push(this.#options.unlock.onUnlocked((payload) => this.#handleUnlocked(payload)));
    this.#subscriptions.push(this.#options.unlock.onLocked((payload) => this.#handleLocked(payload)));
    if (this.#options.unlock.isUnlocked()) {
      void this.#hydrateFromVault();
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

  getAccounts(namespace: string): KeyringAccount[] {
    const runtime = this.#namespaces.get(namespace);
    if (!runtime) {
      return [];
    }
    return runtime.keyring.getAccounts().map((account) => ({ ...account }));
  }

  deriveNextAccount(namespace: string): KeyringAccount {
    const runtime = this.#getNamespaceRuntime(namespace);
    const account = runtime.keyring.deriveNextAccount();
    this.#refreshNamespaceState(namespace, runtime);
    return { ...account };
  }

  importAccount(namespace: string, privateKey: string | Uint8Array): KeyringAccount {
    const runtime = this.#getNamespaceRuntime(namespace);
    const account = runtime.keyring.importAccount(privateKey);
    this.#refreshNamespaceState(namespace, runtime);
    return { ...account };
  }

  removeAccount(namespace: string, address: string): void {
    const runtime = this.#getNamespaceRuntime(namespace);
    runtime.keyring.removeAccount(address);
    this.#refreshNamespaceState(namespace, runtime);
  }

  hasAccount(namespace: string, address: string): boolean {
    const runtime = this.#namespaces.get(namespace);
    return runtime ? runtime.keyring.hasAccount(address) : false;
  }

  exportPrivateKey(namespace: string, address: string): Uint8Array {
    const runtime = this.#getNamespaceRuntime(namespace);
    return runtime.keyring.exportPrivateKey(address);
  }

  // Overwrites any existing namespace runtime with the provided mnemonic.
  setNamespaceFromMnemonic(namespace: string, params: { mnemonic: string; passphrase?: string }): KeyringAccount[] {
    const descriptor = this.#options.namespaces[namespace];
    if (!descriptor) {
      throw new Error(`Namespace "${namespace}" is not supported`);
    }

    const existing = this.#namespaces.get(namespace);
    if (existing) {
      try {
        existing.keyring.clear();
      } catch (error) {
        this.#options.logger?.(`keyring: failed to dispose namespace "${namespace}" before overwrite`, error);
      }
    }

    const keyring = descriptor.createKeyring();
    keyring.loadFromMnemonic(params.mnemonic, params.passphrase ? { passphrase: params.passphrase } : undefined);

    if (keyring.getAccounts().length === 0) {
      keyring.deriveNextAccount();
    }
    const accounts = keyring.getAccounts().map((account) => ({ ...account }));

    const snapshot = toStorableSnapshot(keyring.toSnapshot());
    const envelope: HierarchicalNamespaceEnvelope = {
      type: "hierarchical",
      mnemonic: params.mnemonic,
      ...(params.passphrase ? { passphrase: params.passphrase } : {}),
      snapshot,
    };

    const runtime: NamespaceRuntime = { keyring, descriptor, envelope };
    this.#namespaces.set(namespace, runtime);
    this.#setNamespaceEnvelope(namespace, envelope);
    this.#syncAccountsState();
    this.#notifyEnvelopeUpdated();
    return accounts;
  }

  removeNamespace(namespace: string): void {
    const runtime = this.#namespaces.get(namespace);
    if (runtime) {
      try {
        runtime.keyring.clear();
      } catch (error) {
        this.#options.logger?.(`keyring: failed to clear namespace "${namespace}"`, error);
      }
      this.#namespaces.delete(namespace);
    }
    this.#removeNamespaceEnvelope(namespace);
    this.#notifyEnvelopeUpdated();
    this.#syncAccountsState();
  }

  hasNamespace(namespace: string): boolean {
    return this.#namespaces.has(namespace);
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

      const decoded = decodeEnvelope(exported) ?? createEmptyEnvelope();
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
    for (const [namespace, descriptor] of Object.entries(this.#options.namespaces)) {
      const payload = envelope.namespaces[namespace];
      if (!payload) {
        continue;
      }
      try {
        const keyring = descriptor.createKeyring();
        keyring.loadFromMnemonic(payload.mnemonic, payload.passphrase ? { passphrase: payload.passphrase } : undefined);

        const sanitizedSnapshot = payload.snapshot ? toStorableSnapshot(payload.snapshot) : null;
        if (sanitizedSnapshot) {
          keyring.hydrate(sanitizedSnapshot);
        }

        const sanitizedEnvelope: HierarchicalNamespaceEnvelope = sanitizedSnapshot
          ? { ...payload, snapshot: sanitizedSnapshot }
          : { ...payload };

        const runtime: NamespaceRuntime = { keyring, descriptor, envelope: sanitizedEnvelope };
        this.#namespaces.set(namespace, runtime);
        this.#setNamespaceEnvelope(namespace, sanitizedEnvelope);
      } catch (error) {
        this.#options.logger?.(`keyring: failed to initialize namespace "${namespace}"`, error);
      }
    }
  }

  #ensureEnvelope(): KeyringEnvelope {
    if (!this.#envelope) {
      this.#envelope = createEmptyEnvelope();
    }
    return this.#envelope;
  }

  #setNamespaceEnvelope(namespace: string, envelope: HierarchicalNamespaceEnvelope): void {
    const current = this.#ensureEnvelope();
    this.#envelope = {
      ...current,
      namespaces: {
        ...current.namespaces,
        [namespace]: envelope,
      },
    };
  }

  #removeNamespaceEnvelope(namespace: string): void {
    if (!this.#envelope) {
      return;
    }
    const { [namespace]: _removed, ...rest } = this.#envelope.namespaces;
    this.#envelope = {
      ...this.#envelope,
      namespaces: rest,
    };
  }

  #getNamespaceRuntime(namespace: string): NamespaceRuntime {
    const runtime = this.#namespaces.get(namespace);
    if (!runtime) {
      throw new Error(`Namespace "${namespace}" is not initialized`);
    }
    return runtime;
  }

  #refreshNamespaceState(namespace: string, runtime: NamespaceRuntime): void {
    const snapshot = toStorableSnapshot(runtime.keyring.toSnapshot());
    const nextEnvelope: HierarchicalNamespaceEnvelope = { ...runtime.envelope, snapshot };
    runtime.envelope = nextEnvelope;
    this.#setNamespaceEnvelope(namespace, nextEnvelope);
    this.#syncAccountsState();
    this.#notifyEnvelopeUpdated();
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

  #buildNamespacesState(current: MultiNamespaceAccountsState<string>): Record<string, NamespaceAccountsState<string>> {
    const result: Record<string, NamespaceAccountsState<string>> = {};

    for (const [namespace, runtime] of this.#namespaces.entries()) {
      const canonicalAccounts = runtime.keyring.getAccounts().map((account) => account.address);
      const previous = current.namespaces[namespace] ?? { all: [], primary: null };
      const primary = this.#resolvePrimaryAddress(canonicalAccounts, previous.primary);
      result[namespace] = { all: canonicalAccounts, primary };
    }

    return result;
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
  #resolvePrimaryAddress(accounts: string[], currentPrimary: string | null): string | null {
    if (currentPrimary && accounts.includes(currentPrimary)) {
      return currentPrimary;
    }
    return accounts[0] ?? null;
  }
  #handleUnlocked(_payload: UnlockUnlockedPayload): void {
    void this.#hydrateFromVault().catch((error) => {
      this.#options.logger?.("keyring: failed to hydrate after unlock", error);
    });
  }

  #handleLocked(_payload: UnlockLockedPayload): void {
    this.#clearNamespaces();
    this.#envelope = null;

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
      try {
        runtime.keyring.clear();
      } catch (error) {
        this.#options.logger?.("keyring: failed to clear runtime keyring", error);
      }
    }
    this.#namespaces.clear();
  }
}
