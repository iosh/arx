import type { AccountId } from "../accounts/accountId.js";
import type { Namespace } from "../namespaces/types.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import {
  changeVaultPassword,
  createUnlockedVault,
  replaceVaultPlaintext,
  type UnlockedVault,
  unlockVaultRecord,
} from "../vault/crypto.js";
import { type EncryptedVaultRecord, encryptedVaultWrites } from "../vault/persistence.js";
import { deriveBip39Seed } from "./bip39.js";
import type { KeyringBootstrap } from "./bootstrap.js";
import {
  HdKeyringAlreadyExistsError,
  HdKeyringNotFoundError,
  HdKeyringRequiresBip39SourceError,
  KeyringLockedError,
  KeyringNotInitializedError,
  KeySourceBackupUnsupportedError,
  KeySourceNotFoundError,
  KeySourceRequiresHdKeyringError,
  KeySourceTypeMismatchError,
} from "./errors.js";
import { getKeyringNamespaceAdapter, type KeyringNamespaceAdapters } from "./namespaceAdapter.js";
import {
  type Bip39KeySourceRecord,
  type HdKeyringId,
  type HdKeyringRecord,
  hdKeyringWrites,
  type KeySourceId,
  type KeySourceRecord,
  keySourceWrites,
  type PrivateKeySourceRecord,
} from "./persistence.js";
import {
  type Bip39KeySourceSecret,
  createKeyringSecrets,
  decodeKeyringSecrets,
  encodeKeyringSecrets,
  findKeySourceSecret,
  type KeyringSecrets,
  type KeySourceSecret,
  type PrivateKeySourceSecret,
} from "./secrets.js";
import type { BackupStatus, KeyringChanged } from "./types.js";

/**
 * Prepare and activate within one shared mutation queue operation.
 * Activate once, after the complete wallet command commits.
 */
export type KeyringUpdate = Readonly<{
  persistenceChanges: readonly PersistenceChange[];
  activate(): void;
}>;

/**
 * Includes an initial HD keyring with nextDerivationIndex 1.
 * The same wallet command commits its account at derivation index 0.
 */
export type Bip39SourceAddition = KeyringUpdate &
  Readonly<{
    keySourceId: KeySourceId;
    hdKeyringId: HdKeyringId;
  }>;

type SoftwareKeyState =
  | Readonly<{ status: "uninitialized" }>
  | Readonly<{ status: "locked"; record: EncryptedVaultRecord }>
  | Readonly<{ status: "unlocked"; vault: UnlockedVault; secrets: KeyringSecrets }>;

export type SoftwareKeyStatus = SoftwareKeyState["status"];

/** Updates can be combined only when they change different record collections. */
type RecordUpdate = Readonly<{
  nextKeySources?: ReadonlyMap<KeySourceId, KeySourceRecord>;
  nextHdKeyrings?: ReadonlyMap<HdKeyringId, HdKeyringRecord>;
  persistenceChanges: readonly PersistenceChange[];
}>;

type Bip39SourceInput = Readonly<{
  secret: Bip39KeySourceSecret;
  name: string;
  backupStatus: BackupStatus;
  namespace: Namespace;
  createdAt: number;
}>;

type PrivateKeySourceInput = Readonly<{
  secret: PrivateKeySourceSecret;
  namespace: Namespace;
  createdAt: number;
}>;

type KeyringOptions = Readonly<{
  bootstrap: KeyringBootstrap;
  namespaceAdapters: KeyringNamespaceAdapters;
  mutations: CoreMutationQueue;
  publishChanged(change: KeyringChanged): void;
}>;

const sharesDerivationSequence = (left: HdKeyringRecord, right: HdKeyringRecord): boolean =>
  left.keySourceId === right.keySourceId && left.namespace === right.namespace;

/** Owns source/HD records and all software key material for the current runtime. */
export class Keyring {
  readonly #namespaceAdapters: KeyringNamespaceAdapters;
  readonly #mutations: CoreMutationQueue;
  readonly #publishChanged: KeyringOptions["publishChanged"];
  #keySources: ReadonlyMap<KeySourceId, KeySourceRecord>;
  #hdKeyrings: ReadonlyMap<HdKeyringId, HdKeyringRecord>;
  #softwareState: SoftwareKeyState;

  constructor(options: KeyringOptions) {
    const bootstrap = options.bootstrap;
    this.#namespaceAdapters = options.namespaceAdapters;
    this.#mutations = options.mutations;
    this.#publishChanged = options.publishChanged;
    this.#keySources = new Map(bootstrap.keySources.map((source) => [source.keySourceId, source]));
    this.#hdKeyrings = new Map(bootstrap.hdKeyrings.map((hdKeyring) => [hdKeyring.hdKeyringId, hdKeyring]));
    this.#softwareState = bootstrap.encryptedVault
      ? { status: "locked", record: bootstrap.encryptedVault }
      : { status: "uninitialized" };
  }

  getSoftwareKeyStatus(): SoftwareKeyStatus {
    return this.#softwareState.status;
  }

  getKeySource(keySourceId: KeySourceId): KeySourceRecord | null {
    return this.#keySources.get(keySourceId) ?? null;
  }

  listKeySources(): readonly KeySourceRecord[] {
    return [...this.#keySources.values()].sort(
      (left, right) => left.createdAt - right.createdAt || left.keySourceId.localeCompare(right.keySourceId),
    );
  }

  getHdKeyring(hdKeyringId: HdKeyringId): HdKeyringRecord | null {
    return this.#hdKeyrings.get(hdKeyringId) ?? null;
  }

  listHdKeyrings(): readonly HdKeyringRecord[] {
    return [...this.#hdKeyrings.values()].sort(
      (left, right) => left.createdAt - right.createdAt || left.hdKeyringId.localeCompare(right.hdKeyringId),
    );
  }

  listHdKeyringsByKeySourceIds(keySourceIds: readonly KeySourceId[]): readonly HdKeyringRecord[] {
    const selected = new Set(keySourceIds);
    return this.listHdKeyrings().filter((hdKeyring) => selected.has(hdKeyring.keySourceId));
  }

  listHdKeyringsByNamespace(namespace: string): readonly HdKeyringRecord[] {
    return this.listHdKeyrings().filter((hdKeyring) => hdKeyring.namespace === namespace);
  }

  /** Trusted core consumers retain only the requested source, and check the wallet session separately. */
  requireKeySourceSecret(keySourceId: KeySourceId): KeySourceSecret {
    const secret = findKeySourceSecret(this.requireUnlocked().secrets, keySourceId);
    if (!secret) throw new KeySourceNotFoundError(keySourceId);
    return secret;
  }

  findMnemonicSource(mnemonic: string): Bip39KeySourceRecord | null {
    const secret = this.requireUnlocked().secrets.keySources.find(
      (candidate) => candidate.type === "bip39" && candidate.mnemonic === mnemonic,
    );
    return secret ? (this.#keySources.get(secret.keySourceId) as Bip39KeySourceRecord) : null;
  }

  async deriveBip39AccountId(params: {
    namespace: Namespace;
    source: Bip39KeySourceSecret;
    derivationIndex: number;
  }): Promise<AccountId> {
    const seed = await deriveBip39Seed(params.source);
    try {
      return getKeyringNamespaceAdapter(this.#namespaceAdapters, params.namespace).deriveHdAccountId({
        seed,
        derivationIndex: params.derivationIndex,
      });
    } finally {
      seed.fill(0);
    }
  }

  async deriveHdAccountId(params: { hdKeyring: HdKeyringRecord; derivationIndex: number }): Promise<AccountId> {
    // Complete source commands maintain the HD record's relationship to its BIP39 source.
    const source = this.requireKeySourceSecret(params.hdKeyring.keySourceId) as Bip39KeySourceSecret;
    return this.deriveBip39AccountId({
      namespace: params.hdKeyring.namespace,
      source,
      derivationIndex: params.derivationIndex,
    });
  }

  accountIdFromPrivateKey(params: { namespace: Namespace; privateKey: string }): AccountId {
    return getKeyringNamespaceAdapter(this.#namespaceAdapters, params.namespace).accountIdFromPrivateKey(
      params.privateKey,
    );
  }

  /** The wallet command supplies the source of an existing private-key account. */
  accountIdFromPrivateKeySource(keySourceId: KeySourceId): AccountId {
    const source = this.#keySources.get(keySourceId) as PrivateKeySourceRecord;
    const secret = this.requireKeySourceSecret(keySourceId) as PrivateKeySourceSecret;
    return this.accountIdFromPrivateKey({ namespace: source.namespace, privateKey: secret.privateKey });
  }

  /** Prepare and activate within one shared mutation queue operation. */
  async prepareUnlock(password: string): Promise<Readonly<{ activate(): void }> | null> {
    const draft = await unlockVaultRecord(this.requireEncryptedRecord(), password);
    if (draft === null) return null;
    let secrets: KeyringSecrets;
    try {
      secrets = decodeKeyringSecrets(draft.plaintext);
    } finally {
      draft.plaintext.fill(0);
    }
    return {
      activate: () => {
        this.#softwareState = { status: "unlocked", vault: draft.unlocked, secrets };
      },
    };
  }

  async verifyPassword(password: string): Promise<boolean> {
    const { vault } = this.requireUnlocked();
    const verified = await unlockVaultRecord(vault.record, password);
    if (verified === null) return false;
    verified.plaintext.fill(0);
    verified.unlocked.encryptionKey.fill(0);
    return true;
  }

  async prepareChangePassword(params: { currentPassword: string; newPassword: string }): Promise<KeyringUpdate> {
    const state = this.requireUnlocked();
    const vault = await changeVaultPassword({ unlocked: state.vault, ...params });
    return this.encryptedUpdate({ persistenceChanges: [] }, vault, state.secrets);
  }

  /** Runs inside the shared mutation queue after vault operations settle. */
  lock(): void {
    if (this.#softwareState.status === "unlocked") {
      this.#softwareState = { status: "locked", record: this.#softwareState.vault.record };
    }
  }

  async prepareInitializeBip39Source(
    params: Bip39SourceInput & Readonly<{ password: string }>,
  ): Promise<Bip39SourceAddition> {
    const { keySourceId, hdKeyringId, records } = this.prepareBip39Records(params);
    const update = await this.prepareInitialVault(records, createKeyringSecrets([params.secret]), params.password);
    return { keySourceId, hdKeyringId, ...update };
  }

  async prepareInitializePrivateKeySource(
    params: PrivateKeySourceInput & Readonly<{ password: string }>,
  ): Promise<KeyringUpdate> {
    return this.prepareInitialVault(
      this.preparePrivateKeyRecords(params),
      createKeyringSecrets([params.secret]),
      params.password,
    );
  }

  async prepareAddBip39Source(
    params: Bip39SourceInput &
      Readonly<{
        /** The product command first verifies both keys; removal is part of this same source update. */
        removePrivateKeySourceId?: KeySourceId;
      }>,
  ): Promise<Bip39SourceAddition> {
    const secrets = this.requireUnlocked().secrets;
    const { keySourceId, hdKeyringId, records } = this.prepareBip39Records(params);
    const remaining =
      params.removePrivateKeySourceId === undefined
        ? secrets.keySources
        : secrets.keySources.filter((source) => source.keySourceId !== params.removePrivateKeySourceId);
    const update = await this.prepareSecretsReplacement(records, createKeyringSecrets([...remaining, params.secret]));
    return { keySourceId, hdKeyringId, ...update };
  }

  async prepareAddPrivateKeySource(params: PrivateKeySourceInput): Promise<KeyringUpdate> {
    const secrets = this.requireUnlocked().secrets;
    return this.prepareSecretsReplacement(
      this.preparePrivateKeyRecords(params),
      createKeyringSecrets([...secrets.keySources, params.secret]),
    );
  }

  async prepareRemoveKeySource(keySourceId: KeySourceId): Promise<KeyringUpdate> {
    const secrets = this.requireUnlocked().secrets;
    const removedHdKeyrings = this.listHdKeyringsByKeySourceIds([keySourceId]);
    const nextKeySources = new Map(this.#keySources);
    nextKeySources.delete(keySourceId);
    let records: RecordUpdate = {
      nextKeySources,
      persistenceChanges: [
        keySourceWrites.remove(keySourceId),
        ...removedHdKeyrings.map((hdKeyring) => hdKeyringWrites.remove(hdKeyring.hdKeyringId)),
      ],
    };
    if (removedHdKeyrings.length > 0) {
      const nextHdKeyrings = new Map(this.#hdKeyrings);
      for (const hdKeyring of removedHdKeyrings) nextHdKeyrings.delete(hdKeyring.hdKeyringId);
      records = { ...records, nextHdKeyrings };
    }
    return this.prepareSecretsReplacement(
      records,
      createKeyringSecrets(secrets.keySources.filter((candidate) => candidate.keySourceId !== keySourceId)),
    );
  }

  renameMnemonicSource({ keySourceId, name }: { keySourceId: KeySourceId; name: string }): Promise<void> {
    return this.commitKeySourceUpdate(keySourceId, (source) => {
      if (source.type !== "bip39") {
        throw new KeySourceTypeMismatchError({ keySourceId, expectedType: "bip39", actualType: source.type });
      }
      return source.name === name ? null : { ...source, name };
    });
  }

  confirmMnemonicBackup({ keySourceId }: { keySourceId: KeySourceId }): Promise<void> {
    return this.commitKeySourceUpdate(keySourceId, (source) => {
      if (source.type !== "bip39") throw new KeySourceBackupUnsupportedError(keySourceId);
      return source.backupStatus === "confirmed" ? null : { ...source, backupStatus: "confirmed" };
    });
  }

  prepareAddHdKeyring(hdKeyring: HdKeyringRecord): KeyringUpdate {
    this.assertBip39Source(hdKeyring.keySourceId);
    const existing = [...this.#hdKeyrings.values()].find((candidate) => sharesDerivationSequence(candidate, hdKeyring));
    if (existing) {
      throw new HdKeyringAlreadyExistsError({
        existingHdKeyringId: existing.hdKeyringId,
        keySourceId: hdKeyring.keySourceId,
        namespace: hdKeyring.namespace,
      });
    }
    const nextHdKeyrings = new Map(this.#hdKeyrings);
    nextHdKeyrings.set(hdKeyring.hdKeyringId, hdKeyring);
    return this.recordUpdate({ nextHdKeyrings, persistenceChanges: [hdKeyringWrites.put(hdKeyring)] });
  }

  prepareAdvanceHdKeyring(current: HdKeyringRecord): KeyringUpdate {
    const advanced = { ...current, nextDerivationIndex: current.nextDerivationIndex + 1 };
    const nextHdKeyrings = new Map(this.#hdKeyrings);
    nextHdKeyrings.set(current.hdKeyringId, advanced);
    return this.recordUpdate({ nextHdKeyrings, persistenceChanges: [hdKeyringWrites.put(advanced)] });
  }

  prepareRemoveHdKeyring(hdKeyringId: HdKeyringId): KeyringUpdate {
    const current = this.requireHdKeyring(hdKeyringId);
    if (this.listHdKeyringsByKeySourceIds([current.keySourceId]).length === 1) {
      throw new KeySourceRequiresHdKeyringError(current.keySourceId);
    }
    const nextHdKeyrings = new Map(this.#hdKeyrings);
    nextHdKeyrings.delete(hdKeyringId);
    return this.recordUpdate({ nextHdKeyrings, persistenceChanges: [hdKeyringWrites.remove(hdKeyringId)] });
  }

  private prepareBip39Records(
    params: Bip39SourceInput & Readonly<{ removePrivateKeySourceId?: KeySourceId }>,
  ): Readonly<{ keySourceId: KeySourceId; hdKeyringId: HdKeyringId; records: RecordUpdate }> {
    const keySourceId = params.secret.keySourceId;
    const hdKeyringId = crypto.randomUUID();
    const source: Bip39KeySourceRecord = {
      keySourceId,
      type: "bip39",
      name: params.name,
      backupStatus: params.backupStatus,
      createdAt: params.createdAt,
    };
    const hdKeyring: HdKeyringRecord = {
      hdKeyringId,
      keySourceId,
      namespace: params.namespace,
      nextDerivationIndex: 1,
      createdAt: params.createdAt,
    };
    const nextKeySources = new Map(this.#keySources);
    nextKeySources.set(keySourceId, source);
    const nextHdKeyrings = new Map(this.#hdKeyrings);
    nextHdKeyrings.set(hdKeyringId, hdKeyring);
    const persistenceChanges: PersistenceChange[] = [keySourceWrites.put(source), hdKeyringWrites.put(hdKeyring)];
    if (params.removePrivateKeySourceId !== undefined) {
      nextKeySources.delete(params.removePrivateKeySourceId);
      persistenceChanges.push(keySourceWrites.remove(params.removePrivateKeySourceId));
    }
    return { keySourceId, hdKeyringId, records: { nextKeySources, nextHdKeyrings, persistenceChanges } };
  }

  private preparePrivateKeyRecords(params: PrivateKeySourceInput): RecordUpdate {
    const source: PrivateKeySourceRecord = {
      keySourceId: params.secret.keySourceId,
      type: "private-key",
      namespace: params.namespace,
      createdAt: params.createdAt,
    };
    const nextKeySources = new Map(this.#keySources);
    nextKeySources.set(source.keySourceId, source);
    return { nextKeySources, persistenceChanges: [keySourceWrites.put(source)] };
  }

  private recordUpdate(records: RecordUpdate): KeyringUpdate {
    return { persistenceChanges: records.persistenceChanges, activate: () => this.applyRecords(records) };
  }

  private async prepareInitialVault(
    records: RecordUpdate,
    secrets: KeyringSecrets,
    password: string,
  ): Promise<KeyringUpdate> {
    const plaintext = encodeKeyringSecrets(secrets);
    let vault: UnlockedVault;
    try {
      vault = await createUnlockedVault({ password, plaintext });
    } finally {
      plaintext.fill(0);
    }
    return this.encryptedUpdate(records, vault, secrets);
  }

  private async prepareSecretsReplacement(records: RecordUpdate, secrets: KeyringSecrets): Promise<KeyringUpdate> {
    const plaintext = encodeKeyringSecrets(secrets);
    let vault: UnlockedVault;
    try {
      vault = await replaceVaultPlaintext(this.requireUnlocked().vault, plaintext);
    } finally {
      plaintext.fill(0);
    }
    return this.encryptedUpdate(records, vault, secrets);
  }

  private encryptedUpdate(records: RecordUpdate, vault: UnlockedVault, secrets: KeyringSecrets): KeyringUpdate {
    return {
      persistenceChanges: [encryptedVaultWrites.put(vault.record), ...records.persistenceChanges],
      activate: () => {
        this.applyRecords(records);
        this.#softwareState = { status: "unlocked", vault, secrets };
      },
    };
  }

  private applyRecords(update: RecordUpdate): void {
    if (update.nextKeySources) this.#keySources = update.nextKeySources;
    if (update.nextHdKeyrings) this.#hdKeyrings = update.nextHdKeyrings;
  }

  private async commitKeySourceUpdate(
    keySourceId: KeySourceId,
    update: (source: KeySourceRecord) => KeySourceRecord | null,
  ): Promise<void> {
    await this.#mutations.run(async (commit) => {
      const source = this.#keySources.get(keySourceId);
      if (!source) throw new KeySourceNotFoundError(keySourceId);
      const nextSource = update(source);
      if (!nextSource) return;
      const nextKeySources = new Map(this.#keySources);
      nextKeySources.set(keySourceId, nextSource);
      const prepared = this.recordUpdate({ nextKeySources, persistenceChanges: [keySourceWrites.put(nextSource)] });
      await commit(prepared.persistenceChanges);
      prepared.activate();
      this.#publishChanged({ type: "keyringChanged" });
    });
  }

  private requireUnlocked(): Extract<SoftwareKeyState, { status: "unlocked" }> {
    if (this.#softwareState.status !== "unlocked") throw new KeyringLockedError();
    return this.#softwareState;
  }

  private requireEncryptedRecord(): EncryptedVaultRecord {
    if (this.#softwareState.status === "uninitialized") throw new KeyringNotInitializedError();
    return this.#softwareState.status === "locked" ? this.#softwareState.record : this.#softwareState.vault.record;
  }

  private requireHdKeyring(hdKeyringId: HdKeyringId): HdKeyringRecord {
    const record = this.#hdKeyrings.get(hdKeyringId);
    if (!record) throw new HdKeyringNotFoundError(hdKeyringId);
    return record;
  }

  private assertBip39Source(keySourceId: KeySourceId): void {
    const source = this.#keySources.get(keySourceId);
    if (!source) throw new KeySourceNotFoundError(keySourceId);
    if (source.type !== "bip39") throw new HdKeyringRequiresBip39SourceError(keySourceId);
  }
}
