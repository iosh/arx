import { getAccountIdNamespace } from "../../accounts/addressing/accountId.js";
import { KeyringDuplicateAccountError, KeyringSecretUnavailableError } from "../../keyring/errors.js";
import type { HierarchicalDeterministicKeyring, SimpleKeyring } from "../../keyring/types.js";
import type { UnlockLockedPayload } from "../../runtime/session/unlock/types.js";
import type { AccountRecord, KeyringMetaRecord } from "../../storage/records.js";
import { decodePayload, encodePayload } from "./keyring-utils.js";
import type { NamespaceConfig } from "./namespaces.js";
import {
  type RuntimeKeyringReconciliationResult,
  reconcileRuntimeKeyringState,
} from "./reconcileRuntimeKeyringState.js";
import type {
  AccountId,
  KeyringPayloadListener,
  KeyringServiceOptions,
  KeyringStateListener,
  Payload,
  RuntimeAccountRef,
  RuntimeKeyring,
  VaultKeyringEntry,
} from "./types.js";

const HYDRATION_TIMEOUT_MS = 10_000;

const clonePayloadEntry = (entry: VaultKeyringEntry): VaultKeyringEntry => structuredClone(entry);
const clonePayload = (payload: Payload): Payload => ({
  keyrings: payload.keyrings.map((entry) => clonePayloadEntry(entry)),
});
const cloneKeyringMeta = (record: KeyringMetaRecord): KeyringMetaRecord => ({ ...record });
const cloneAccountRecord = (record: AccountRecord): AccountRecord => ({ ...record });
const cloneAccountRef = (ref: RuntimeAccountRef): RuntimeAccountRef => ({ ...ref });

type HydrationSnapshot = {
  payload: Payload;
  reconciliation: RuntimeKeyringReconciliationResult;
  shouldResealPayload: boolean;
};

type RuntimeKeyringFactory = () => HierarchicalDeterministicKeyring | SimpleKeyring;

export class RuntimeKeyringState {
  #options: KeyringServiceOptions;
  #defaultNamespace: string;
  #namespacesConfig: Map<string, NamespaceConfig>;

  #keyrings = new Map<string, RuntimeKeyring>();
  #keyringMetas = new Map<string, KeyringMetaRecord>();
  #accounts = new Map<AccountId, AccountRecord>();
  #payload: Payload = { keyrings: [] };
  #payloadListeners = new Set<KeyringPayloadListener>();
  #stateListeners = new Set<KeyringStateListener>();
  #addressIndex = new Map<AccountId, RuntimeAccountRef>();

  #subscriptions: Array<() => void> = [];
  #hydrationPromise: Promise<void> | null = null;
  #epoch = 0;

  constructor(options: KeyringServiceOptions) {
    this.#options = options;
    const [first] = options.namespaces;
    if (!first) {
      throw new Error("No keyring namespace configured");
    }
    this.#defaultNamespace = first.namespace;
    this.#namespacesConfig = new Map(options.namespaces.map((namespace) => [namespace.namespace, namespace]));
  }

  async attach() {
    if (this.#subscriptions.length === 0) {
      this.#subscriptions.push(this.#options.unlock.onLocked((payload) => this.#handleLocked(payload)));
    }

    if (this.#options.vault.getStatus() === "unlocked") {
      await this.#hydrate();
    }
  }

  detach() {
    this.#epoch += 1;
    this.#hydrationPromise = null;

    for (const unsubscribe of this.#subscriptions.splice(0)) {
      unsubscribe();
    }

    this.#clearRuntimeState();
    this.#payload = { keyrings: [] };
    this.#addressIndex.clear();
  }

  async waitForReady(): Promise<void> {
    const hydration = this.#hydrationPromise;
    if (!hydration) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        hydration,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Hydration timeout")), HYDRATION_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  onPayloadUpdated(handler: KeyringPayloadListener): () => void {
    this.#payloadListeners.add(handler);
    return () => this.#payloadListeners.delete(handler);
  }

  onStateChanged(handler: KeyringStateListener): () => void {
    this.#stateListeners.add(handler);
    return () => this.#stateListeners.delete(handler);
  }

  getRuntimeKeyring(keyringId: string): RuntimeKeyring | null {
    return this.#keyrings.get(keyringId) ?? null;
  }

  getKeyringMeta(keyringId: string): KeyringMetaRecord | null {
    const meta = this.#keyringMetas.get(keyringId);
    return meta ? cloneKeyringMeta(meta) : null;
  }

  getAccount(accountId: AccountId): AccountRecord | null {
    const account = this.#accounts.get(accountId);
    return account ? cloneAccountRecord(account) : null;
  }

  getAccountRef(accountId: AccountId): RuntimeAccountRef | null {
    const ref = this.#addressIndex.get(accountId);
    return ref ? cloneAccountRef(ref) : null;
  }

  getPayloadEntry(keyringId: string): VaultKeyringEntry | null {
    const entry = this.#payload.keyrings.find((candidate) => candidate.keyringId === keyringId);
    return entry ? clonePayloadEntry(entry) : null;
  }

  getPayload(): Payload {
    return clonePayload(this.#payload);
  }

  getKeyrings(): KeyringMetaRecord[] {
    return Array.from(this.#keyringMetas.values())
      .map((meta) => cloneKeyringMeta(meta))
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  getAccounts(includeHidden = false): AccountRecord[] {
    return Array.from(this.#accounts.values())
      .filter((account) => includeHidden || !account.hidden)
      .map((account) => cloneAccountRecord(account))
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  getAccountsByKeyring(keyringId: string, includeHidden = false): AccountRecord[] {
    return this.getAccounts(includeHidden).filter((account) => account.keyringId === keyringId);
  }

  hasAccountId(accountId: AccountId): boolean {
    return this.#addressIndex.has(accountId);
  }

  async commitPersistedKeyring(
    params: {
      keyringId: string;
      kind: RuntimeKeyring["kind"];
      namespace: string;
      instance: HierarchicalDeterministicKeyring | SimpleKeyring;
      meta: KeyringMetaRecord;
      accounts: AccountRecord[];
      payloadEntry: VaultKeyringEntry;
    },
    options: { notifyPayloadUpdated?: boolean } = {},
  ): Promise<void> {
    this.#keyrings.set(params.keyringId, {
      id: params.keyringId,
      kind: params.kind,
      namespace: params.namespace,
      instance: params.instance,
    });
    this.#keyringMetas.set(params.keyringId, cloneKeyringMeta(params.meta));

    for (const record of params.accounts) {
      this.#accounts.set(record.accountId, cloneAccountRecord(record));
    }

    this.#payload = {
      keyrings: [
        ...this.#payload.keyrings.filter((entry) => entry.keyringId !== params.keyringId),
        clonePayloadEntry(params.payloadEntry),
      ],
    };

    this.#reindexHydratedAccounts();
    if (options.notifyPayloadUpdated !== false) {
      await this.#notifyPayloadUpdated();
    }
    this.#notifyStateChanged();
  }

  replaceKeyringMeta(record: KeyringMetaRecord): void {
    this.#keyringMetas.set(record.id, cloneKeyringMeta(record));
    this.#notifyStateChanged();
  }

  replaceAccountRecord(record: AccountRecord, strictIndex = true): void {
    this.#accounts.set(record.accountId, cloneAccountRecord(record));
    this.#reindexHydratedAccounts(strictIndex);
    this.#notifyStateChanged();
  }

  dropAccountRecord(accountId: AccountId, strictIndex = false): void {
    this.#accounts.delete(accountId);
    this.#reindexHydratedAccounts(strictIndex);
    this.#notifyStateChanged();
  }

  async dropKeyring(keyringId: string, options: { notifyPayloadUpdated?: boolean } = {}): Promise<void> {
    this.#payload = {
      keyrings: this.#payload.keyrings.filter((entry) => entry.keyringId !== keyringId),
    };

    const runtime = this.#keyrings.get(keyringId);
    if (runtime) {
      runtime.instance.clear();
    }

    this.#keyrings.delete(keyringId);
    this.#keyringMetas.delete(keyringId);

    for (const [accountId, account] of Array.from(this.#accounts.entries())) {
      if (account.keyringId === keyringId) {
        this.#accounts.delete(accountId);
      }
    }

    this.#reindexHydratedAccounts(false);
    if (options.notifyPayloadUpdated !== false) {
      await this.#notifyPayloadUpdated();
    }
    this.#notifyStateChanged();
  }

  async #hydrate() {
    const existing = this.#hydrationPromise;
    if (existing) {
      return existing;
    }

    this.#epoch += 1;
    const epoch = this.#epoch;
    const isStale = () => epoch !== this.#epoch;

    const hydration = (async (): Promise<void> => {
      try {
        if (isStale()) {
          return;
        }

        if (this.#options.vault.getStatus() !== "unlocked") {
          this.#clearRuntimeState();
          this.#payload = { keyrings: [] };
          return;
        }

        const hydrationSnapshot = await this.#loadHydrationSnapshot();

        if (isStale()) {
          return;
        }

        await this.#applyHydrationSnapshot(hydrationSnapshot);
      } catch (error) {
        if (isStale()) {
          return;
        }

        this.#clearRuntimeState();
        this.#payload = { keyrings: [] };

        await this.#options.onHydrationError?.(error);

        throw error;
      }
    })();

    this.#hydrationPromise = hydration;

    try {
      await hydration;
    } finally {
      if (this.#hydrationPromise === hydration) {
        this.#hydrationPromise = null;
      }
    }

    return hydration;
  }

  async #loadHydrationSnapshot(): Promise<HydrationSnapshot> {
    const [storedMetas, storedAccounts] = await Promise.all([
      this.#options.keyringMetas.list(),
      this.#options.accountsStore.list({ includeHidden: true }),
    ]);

    let payload: Payload;
    let shouldResealPayload = false;

    const secret = this.#options.vault.exportSecret();
    try {
      payload = decodePayload(secret);
    } catch (error) {
      if (storedMetas.length === 0 && storedAccounts.length === 0) {
        payload = { keyrings: [] };
        shouldResealPayload = true;
      } else {
        throw error;
      }
    }

    const reconciliation = reconcileRuntimeKeyringState({
      payload,
      keyringMetas: storedMetas,
      accounts: storedAccounts,
    });

    return {
      payload,
      reconciliation,
      shouldResealPayload,
    };
  }

  async #applyHydrationSnapshot(snapshot: HydrationSnapshot): Promise<void> {
    this.#clearRuntimeState();
    this.#payload = clonePayload(snapshot.payload);

    for (const meta of snapshot.reconciliation.reconciledMetas) {
      this.#keyringMetas.set(meta.id, cloneKeyringMeta(meta));
    }

    for (const account of snapshot.reconciliation.reconciledAccounts) {
      this.#accounts.set(account.accountId, cloneAccountRecord(account));
    }

    const accounts = snapshot.reconciliation.reconciledAccounts;

    for (const entry of snapshot.payload.keyrings) {
      this.#keyrings.set(entry.keyringId, this.#buildRuntimeKeyring(entry, accounts));
    }

    this.#reindexHydratedAccounts(false);
    await this.#commitHydrationProjectionChanges(snapshot.reconciliation);
    await this.#reconcileNextDerivationIndex();
    this.#notifyStateChanged();

    if (snapshot.shouldResealPayload) {
      await this.#notifyPayloadUpdated();
    }
  }

  async #commitHydrationProjectionChanges(reconciliation: RuntimeKeyringReconciliationResult): Promise<void> {
    for (const keyringId of reconciliation.prunedKeyringIds) {
      await Promise.all([
        this.#options.keyringMetas.remove(keyringId),
        this.#options.accountsStore.removeByKeyringId(keyringId),
      ]);
    }

    for (const meta of reconciliation.repairedMetas) {
      await this.#options.keyringMetas.upsert(meta);
    }
  }

  #buildRuntimeKeyring(entry: VaultKeyringEntry, accounts: AccountRecord[]): RuntimeKeyring {
    try {
      this.#assertHydrationMetadata(entry);

      const namespace = entry.namespace ?? this.#defaultNamespace;
      const config = this.#getNamespaceConfig(namespace);
      const factory = this.#getRuntimeKeyringFactory(entry, config);
      const instance = factory();

      if (entry.type === "hd") {
        this.#loadHdRuntimeKeyring({
          entry,
          config,
          instance: instance as HierarchicalDeterministicKeyring,
          accounts,
        });
      } else {
        this.#loadPrivateKeyRuntimeKeyring({
          entry,
          config,
          instance: instance as SimpleKeyring,
          accounts,
        });
      }

      return {
        id: entry.keyringId,
        kind: entry.type,
        namespace,
        instance,
      };
    } catch (error) {
      const message = `keyring: failed to hydrate keyring ${entry.keyringId}`;
      throw new Error(message, { cause: error });
    }
  }

  #assertHydrationMetadata(entry: VaultKeyringEntry): void {
    if (!this.#keyringMetas.has(entry.keyringId)) {
      throw new Error(`keyring: missing metadata for keyring "${entry.keyringId}" after reconciliation`);
    }
  }

  #getRuntimeKeyringFactory(entry: VaultKeyringEntry, config: NamespaceConfig): RuntimeKeyringFactory {
    const factory = config.factories[entry.type];

    if (!factory) {
      throw new Error(
        `keyring: no runtime factory configured for ${entry.type} keyring "${entry.keyringId}" in namespace "${config.namespace}"`,
      );
    }

    return factory;
  }

  #loadHdRuntimeKeyring(params: {
    entry: VaultKeyringEntry;
    config: NamespaceConfig;
    instance: HierarchicalDeterministicKeyring;
    accounts: AccountRecord[];
  }): void {
    const { entry, config, instance, accounts } = params;
    const hdPayload = entry.payload as { mnemonic?: string[]; passphrase?: string };
    if (!Array.isArray(hdPayload.mnemonic)) {
      throw new KeyringSecretUnavailableError();
    }

    instance.loadFromMnemonic(
      hdPayload.mnemonic.join(" "),
      hdPayload.passphrase ? { passphrase: hdPayload.passphrase } : undefined,
    );

    const derivedAccounts = accounts
      .filter((account) => account.keyringId === entry.keyringId && account.derivationIndex !== undefined)
      .sort((left, right) => (left.derivationIndex ?? 0) - (right.derivationIndex ?? 0));

    for (const account of derivedAccounts) {
      const derived = instance.deriveAccount(account.derivationIndex ?? 0);
      const payloadHex = config.accountAddressing.accountIdPayloadFromAddress({
        chainRef: config.defaultChainRef,
        address: derived.address,
      });
      const expectedAccountId = `${config.namespace}:${payloadHex}`;
      if (expectedAccountId !== account.accountId) {
        throw new Error(
          `keyring: persisted account "${account.accountId}" does not match derived account for keyring "${entry.keyringId}"`,
        );
      }
    }
  }

  #loadPrivateKeyRuntimeKeyring(params: {
    entry: VaultKeyringEntry;
    config: NamespaceConfig;
    instance: SimpleKeyring;
    accounts: AccountRecord[];
  }): void {
    const { entry, config, instance, accounts } = params;
    const privateKeyPayload = entry.payload as { privateKey?: string };
    if (typeof privateKeyPayload.privateKey !== "string") {
      throw new KeyringSecretUnavailableError();
    }

    instance.loadFromPrivateKey(privateKeyPayload.privateKey);

    const persistedAccounts = accounts.filter((account) => account.keyringId === entry.keyringId);
    if (persistedAccounts.length !== 1) {
      throw new Error(
        `keyring: expected exactly one persisted account for private-key keyring "${entry.keyringId}", got ${persistedAccounts.length}`,
      );
    }
    const persistedAccount = persistedAccounts[0];
    if (!persistedAccount) {
      throw new Error(`keyring: missing persisted account for private-key keyring "${entry.keyringId}"`);
    }

    const [runtimeAccount] = instance.getAccounts();
    if (!runtimeAccount) {
      throw new KeyringSecretUnavailableError();
    }

    const payloadHex = config.accountAddressing.accountIdPayloadFromAddress({
      chainRef: config.defaultChainRef,
      address: runtimeAccount.address,
    });
    const expectedAccountId = `${config.namespace}:${payloadHex}`;
    if (persistedAccount.accountId !== expectedAccountId) {
      throw new Error(
        `keyring: persisted account "${persistedAccount.accountId}" does not match private-key account for keyring "${entry.keyringId}"`,
      );
    }
  }

  async #reconcileNextDerivationIndex() {
    const updates: KeyringMetaRecord[] = [];

    for (const [keyringId, meta] of this.#keyringMetas.entries()) {
      if (meta.type !== "hd") {
        continue;
      }

      const accounts = Array.from(this.#accounts.values()).filter((account) => account.keyringId === keyringId);
      const maxIndex = Math.max(-1, ...accounts.map((account) => account.derivationIndex ?? -1));
      const expectedIndex = maxIndex + 1;
      const currentIndex = meta.nextDerivationIndex ?? 0;

      if (currentIndex >= expectedIndex) {
        continue;
      }

      const nextMeta: KeyringMetaRecord = { ...meta, nextDerivationIndex: expectedIndex };
      this.#keyringMetas.set(keyringId, nextMeta);
      updates.push(nextMeta);
    }

    for (const meta of updates) {
      await this.#options.keyringMetas.upsert(meta);
    }
  }

  async #notifyPayloadUpdated(): Promise<void> {
    const encoded = encodePayload(this.#payload);

    for (const listener of this.#payloadListeners) {
      const payload = encoded.length > 0 ? new Uint8Array(encoded) : null;
      await listener(payload);
    }
  }

  #notifyStateChanged(): void {
    for (const listener of this.#stateListeners) {
      listener();
    }
  }

  #reindexHydratedAccounts(strict = true) {
    this.#addressIndex.clear();

    for (const account of this.#accounts.values()) {
      if (!this.#keyrings.has(account.keyringId)) {
        continue;
      }

      if (this.#addressIndex.has(account.accountId)) {
        if (strict) {
          throw new KeyringDuplicateAccountError();
        }
        continue;
      }

      this.#addressIndex.set(account.accountId, {
        namespace: getAccountIdNamespace(account.accountId),
        keyringId: account.keyringId,
        accountId: account.accountId,
      });
    }
  }

  #clearRuntimeState() {
    for (const runtime of this.#keyrings.values()) {
      runtime.instance.clear();
    }

    this.#keyrings.clear();
    this.#keyringMetas.clear();
    this.#accounts.clear();
    this.#addressIndex.clear();
  }

  #handleLocked(_payload: UnlockLockedPayload): void {
    this.#epoch += 1;
    this.#clearRuntimeState();
    this.#payload = { keyrings: [] };
    this.#hydrationPromise = null;
    this.#notifyStateChanged();
  }

  #getNamespaceConfig(namespace: string) {
    const config = this.#namespacesConfig.get(namespace);
    if (!config) {
      throw new Error(`Namespace "${namespace}" is not supported`);
    }
    return config;
  }
}
