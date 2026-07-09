import { getAccountIdNamespace } from "../../accounts/addressing/accountId.js";
import type { UnlockLockedPayload } from "../../session/unlock/types.js";
import type { AccountRecord, KeyringMetaRecord } from "../../storage/records.js";
import {
  KeyringDuplicateAccountError,
  KeyringHydrationMetadataMissingError,
  KeyringHydrationTimeoutError,
} from "../errors.js";
import { buildKeyringHydrationPlan, type KeyringHydrationPlan } from "./keyringHydrationPlan.js";
import type {
  AccountId,
  KeyringPayloadListener,
  KeyringServiceOptions,
  KeyringStateListener,
  Payload,
  UnlockedAccountRef,
  UnlockedKeyring,
  VaultKeyringEntry,
} from "./types.js";
import { decodePayload, encodePayload } from "./vaultPayloadCodec.js";

const HYDRATION_TIMEOUT_MS = 10_000;

const clonePayloadEntry = (entry: VaultKeyringEntry): VaultKeyringEntry => structuredClone(entry);
const clonePayload = (payload: Payload): Payload => ({
  keyrings: payload.keyrings.map((entry) => clonePayloadEntry(entry)),
});
const cloneKeyringMeta = (record: KeyringMetaRecord): KeyringMetaRecord => ({ ...record });
const cloneAccountRecord = (record: AccountRecord): AccountRecord => ({ ...record });
const cloneAccountRef = (ref: UnlockedAccountRef): UnlockedAccountRef => ({ ...ref });

type HydrationSnapshot = {
  payload: Payload;
  plan: KeyringHydrationPlan;
  shouldResealPayload: boolean;
};

type BuildUnlockedKeyring = (entry: VaultKeyringEntry, accounts: readonly AccountRecord[]) => UnlockedKeyring;

export class UnlockedKeyringState {
  #options: KeyringServiceOptions;
  #buildUnlockedKeyring: BuildUnlockedKeyring;

  #keyrings = new Map<string, UnlockedKeyring>();
  #keyringMetas = new Map<string, KeyringMetaRecord>();
  #accounts = new Map<AccountId, AccountRecord>();
  #payload: Payload = { keyrings: [] };
  #payloadListeners = new Set<KeyringPayloadListener>();
  #stateListeners = new Set<KeyringStateListener>();
  #addressIndex = new Map<AccountId, UnlockedAccountRef>();

  #subscriptions: Array<() => void> = [];
  #hydrationPromise: Promise<void> | null = null;
  #epoch = 0;

  constructor(options: KeyringServiceOptions, buildUnlockedKeyring: BuildUnlockedKeyring) {
    this.#options = options;
    this.#buildUnlockedKeyring = buildUnlockedKeyring;
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

    this.#clearUnlockedState();
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
          timeout = setTimeout(() => reject(new KeyringHydrationTimeoutError()), HYDRATION_TIMEOUT_MS);
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

  getUnlockedKeyring(keyringId: string): UnlockedKeyring | null {
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

  getAccountRef(accountId: AccountId): UnlockedAccountRef | null {
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
      kind: UnlockedKeyring["kind"];
      namespace: string;
      instance: UnlockedKeyring["instance"];
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

    const unlockedKeyring = this.#keyrings.get(keyringId);
    if (unlockedKeyring) {
      unlockedKeyring.instance.clear();
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
          this.#clearUnlockedState();
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

        this.#clearUnlockedState();
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

    const plan = buildKeyringHydrationPlan({
      payload,
      keyringMetas: storedMetas,
      accounts: storedAccounts,
    });

    return {
      payload,
      plan,
      shouldResealPayload,
    };
  }

  async #applyHydrationSnapshot(snapshot: HydrationSnapshot): Promise<void> {
    this.#clearUnlockedState();
    this.#payload = clonePayload(snapshot.payload);

    for (const meta of snapshot.plan.metasToLoad) {
      this.#keyringMetas.set(meta.id, cloneKeyringMeta(meta));
    }

    for (const account of snapshot.plan.accountsToLoad) {
      this.#accounts.set(account.accountId, cloneAccountRecord(account));
    }

    const accounts = snapshot.plan.accountsToLoad;

    for (const entry of snapshot.payload.keyrings) {
      this.#assertHydrationMetadata(entry);
      this.#keyrings.set(entry.keyringId, this.#buildUnlockedKeyring(entry, accounts));
    }

    this.#reindexHydratedAccounts(false);
    await this.#applyHydrationStorageChanges(snapshot.plan);
    await this.#advanceHdDerivationIndexesFromAccounts();
    this.#notifyStateChanged();

    if (snapshot.shouldResealPayload) {
      await this.#notifyPayloadUpdated();
    }
  }

  async #applyHydrationStorageChanges(plan: KeyringHydrationPlan): Promise<void> {
    for (const keyringId of plan.keyringIdsToRemove) {
      await Promise.all([
        this.#options.keyringMetas.remove(keyringId),
        this.#options.accountsStore.removeByKeyringId(keyringId),
      ]);
    }

    for (const meta of plan.metasToCreate) {
      await this.#options.keyringMetas.upsert(meta);
    }
  }

  #assertHydrationMetadata(entry: VaultKeyringEntry): void {
    if (!this.#keyringMetas.has(entry.keyringId)) {
      throw new KeyringHydrationMetadataMissingError(entry.keyringId, entry.type);
    }
  }

  async #advanceHdDerivationIndexesFromAccounts() {
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

  #clearUnlockedState() {
    for (const unlockedKeyring of this.#keyrings.values()) {
      unlockedKeyring.instance.clear();
    }

    this.#keyrings.clear();
    this.#keyringMetas.clear();
    this.#accounts.clear();
    this.#addressIndex.clear();
  }

  #handleLocked(_payload: UnlockLockedPayload): void {
    this.#epoch += 1;
    this.#clearUnlockedState();
    this.#payload = { keyrings: [] };
    this.#hydrationPromise = null;
    this.#notifyStateChanged();
  }
}
