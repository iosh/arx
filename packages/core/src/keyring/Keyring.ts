import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { type AccountId, getAccountIdNamespace } from "../accounts/accountId.js";
import type { AccountGroupSource, AccountRecord } from "../accounts/persistence.js";
import type { Namespace } from "../namespaces/types.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import { commitUpdates, type PreparedUpdate } from "../persistence/preparedUpdate.js";
import { createUnlockedVault, replaceVaultPlaintext, type UnlockedVault, unlockVaultRecord } from "../vault/crypto.js";
import { type EncryptedVaultRecord, encryptedVaultWrites } from "../vault/persistence.js";
import { deriveBip39Seed } from "./bip39.js";
import type { KeyringBootstrap } from "./bootstrap.js";
import { KeyringInvalidPrivateKeyError, KeySourceNotFoundError } from "./errors.js";
import type { KeyringNamespaceAdapters } from "./namespaceAdapter.js";
import { keySourceWrites } from "./persistence.js";
import {
  createKeyringSecrets,
  decodeKeyringSecrets,
  encodeKeyringSecrets,
  findKeySourceSecret,
  type KeyringSecrets,
  type KeySourceSecret,
  type PrivateKeySourceSecret,
} from "./secrets.js";
import type { BackupStatus, KeyringChanged, KeySource, KeySourceId } from "./types.js";

/** Discards newly derived encryption material if the prepared vault does not commit. */
export type PreparedKeyringUpdate = PreparedUpdate & Readonly<{ discard(): void }>;

export type KeySourceAddition = Readonly<{
  update: PreparedKeyringUpdate;
  keySourceId: KeySourceId;
}>;

export type PrivateKeySourceAddition = KeySourceAddition & Readonly<{ accountId: AccountId }>;

type SoftwareKeyState =
  | Readonly<{ status: "uninitialized" }>
  | Readonly<{ status: "locked"; record: EncryptedVaultRecord }>
  | Readonly<{ status: "unlocked"; vault: UnlockedVault; secrets: KeyringSecrets }>;

export type SoftwareKeyStatus = SoftwareKeyState["status"];

type RecordUpdate = Readonly<{
  nextKeySources?: ReadonlyMap<KeySourceId, KeySource>;
  persistenceChanges: readonly PersistenceChange[];
}>;

/** The mnemonic text has already been decoded by the keyring's BIP39 input function. */
type Bip39SourceInput = Readonly<{
  mnemonic: string;
  name: string;
  backupStatus: BackupStatus;
  createdAt: number;
}>;

type PrivateKeySourceInput = Readonly<{
  privateKey: string;
  namespace: Namespace;
  createdAt: number;
}>;

type KeyringOptions = Readonly<{
  bootstrap: KeyringBootstrap;
  namespaceAdapters: KeyringNamespaceAdapters;
  mutations: CoreMutationQueue;
  publishChanged(change: KeyringChanged): void;
}>;

/** Owns source records and all software key material for the current runtime. */
export class Keyring {
  readonly #namespaceAdapters: KeyringNamespaceAdapters;
  readonly #mutations: CoreMutationQueue;
  readonly #publishChanged: KeyringOptions["publishChanged"];
  #keySources: ReadonlyMap<KeySourceId, KeySource>;
  #softwareState: SoftwareKeyState;

  constructor(options: KeyringOptions) {
    this.#namespaceAdapters = options.namespaceAdapters;
    this.#mutations = options.mutations;
    this.#publishChanged = options.publishChanged;
    this.#keySources = new Map(options.bootstrap.keySources.map((source) => [source.keySourceId, source]));
    this.#softwareState = options.bootstrap.encryptedVault
      ? { status: "locked", record: options.bootstrap.encryptedVault }
      : { status: "uninitialized" };
  }

  getSoftwareKeyStatus(): SoftwareKeyStatus {
    return this.#softwareState.status;
  }

  getKeySource(keySourceId: KeySourceId): KeySource | null {
    return this.#keySources.get(keySourceId) ?? null;
  }

  listKeySources(): readonly KeySource[] {
    return [...this.#keySources.values()].sort(
      (left, right) => left.createdAt - right.createdAt || left.keySourceId.localeCompare(right.keySourceId),
    );
  }

  findMnemonicSource(mnemonic: string): Extract<KeySource, { type: "bip39" }> | null {
    const secret = this.requireUnlocked().secrets.keySources.find(
      (candidate) => candidate.type === "bip39" && candidate.mnemonic === mnemonic,
    );
    if (!secret) return null;
    const source = this.#keySources.get(secret.keySourceId);
    if (source?.type !== "bip39") throw new Error("Mnemonic source records are inconsistent.");
    return source;
  }

  deriveBip39AccountIds(params: {
    mnemonic: string;
    namespaces: readonly [Namespace, ...Namespace[]];
    accountIndex: number;
  }): readonly [AccountRecord, ...AccountRecord[]] {
    const seed = deriveBip39Seed(params.mnemonic);
    const derive = (namespace: Namespace): AccountRecord => {
      const adapter = this.#namespaceAdapters[namespace];
      const privateKey = adapter.derivePrivateKey({ seed, accountIndex: params.accountIndex });
      try {
        return { accountId: adapter.accountIdFromPrivateKey(privateKey) };
      } finally {
        privateKey.fill(0);
      }
    };
    try {
      const [first, ...rest] = params.namespaces;
      return [derive(first), ...rest.map(derive)];
    } finally {
      seed.fill(0);
    }
  }

  deriveHdAccountIds(params: {
    keySourceId: KeySourceId;
    namespaces: readonly [Namespace, ...Namespace[]];
    accountIndex: number;
  }): readonly [AccountRecord, ...AccountRecord[]] {
    const secret = this.requireKeySourceSecret(params.keySourceId);
    if (secret.type !== "bip39") throw new Error("HD account derivation requires a BIP39 source.");
    return this.deriveBip39AccountIds({ ...params, mnemonic: secret.mnemonic });
  }

  /** The caller checks the wallet session before this synchronous operation. The callback must finish synchronously. */
  withPrivateKey<T>(
    params: { source: AccountGroupSource; accountId: AccountId },
    use: (privateKey: Uint8Array) => T,
  ): T {
    const secret = this.requireKeySourceSecret(params.source.keySourceId);
    const adapter = this.#namespaceAdapters[getAccountIdNamespace(params.accountId)];
    let privateKey: Uint8Array;
    if (params.source.type === "bip39" && secret.type === "bip39") {
      const seed = deriveBip39Seed(secret.mnemonic);
      try {
        privateKey = adapter.derivePrivateKey({ seed, accountIndex: params.source.accountIndex });
      } finally {
        seed.fill(0);
      }
    } else if (params.source.type === "private-key" && secret.type === "private-key") {
      privateKey = hexToBytes(secret.privateKey);
    } else {
      throw new Error("Account source and key material have different types.");
    }
    try {
      if (adapter.accountIdFromPrivateKey(privateKey) !== params.accountId) {
        throw new Error("Derived key does not match the requested account identity.");
      }
      return use(privateKey);
    } finally {
      privateKey.fill(0);
    }
  }

  exportPrivateKey(params: { source: AccountGroupSource; accountId: AccountId }): string {
    return this.withPrivateKey(params, (privateKey) =>
      this.#namespaceAdapters[getAccountIdNamespace(params.accountId)].formatPrivateKey(privateKey),
    );
  }

  exportMnemonic(keySourceId: KeySourceId): string {
    const secret = this.requireKeySourceSecret(keySourceId);
    if (secret.type !== "bip39") throw new Error("Mnemonic export requires a BIP39 source.");
    return secret.mnemonic;
  }

  previewPrivateKeyAccount(params: { namespace: Namespace; privateKey: string }): AccountId | null {
    const adapter = this.#namespaceAdapters[params.namespace];
    const privateKey = adapter.parsePrivateKey(params.privateKey);
    if (privateKey === null) return null;
    try {
      return adapter.accountIdFromPrivateKey(privateKey);
    } finally {
      privateKey.fill(0);
    }
  }

  async prepareUnlock(password: string): Promise<Readonly<{ activate(): void }> | null> {
    const draft = await unlockVaultRecord(this.requireEncryptedRecord(), password);
    if (draft === null) return null;
    let secrets: KeyringSecrets;
    try {
      secrets = decodeKeyringSecrets(draft.plaintext);
    } catch (error) {
      draft.unlocked.encryptionKey.fill(0);
      throw error;
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
    const verified = await unlockVaultRecord(this.requireUnlocked().vault.record, password);
    if (verified === null) return false;
    verified.plaintext.fill(0);
    verified.unlocked.encryptionKey.fill(0);
    return true;
  }

  async prepareChangePassword(params: {
    currentPassword: string;
    newPassword: string;
  }): Promise<PreparedKeyringUpdate | null> {
    const state = this.requireUnlocked();
    if (!(await this.verifyPassword(params.currentPassword))) return null;
    return this.prepareNewVault({ persistenceChanges: [] }, state.secrets, params.newPassword);
  }

  /** Runs inside the shared mutation queue after vault operations settle. */
  lock(): void {
    if (this.#softwareState.status === "unlocked") {
      const { vault } = this.#softwareState;
      vault.encryptionKey.fill(0);
      this.#softwareState = { status: "locked", record: vault.record };
    }
  }

  async prepareInitializeBip39Source(
    params: Bip39SourceInput & Readonly<{ password: string }>,
  ): Promise<KeySourceAddition> {
    const keySourceId = crypto.randomUUID();
    const secret: KeySourceSecret = { keySourceId, type: "bip39", mnemonic: params.mnemonic };
    const record: KeySource = {
      keySourceId,
      type: "bip39",
      name: params.name,
      backupStatus: params.backupStatus,
      createdAt: params.createdAt,
    };
    const update = await this.prepareNewVault(
      this.prepareSourceRecords(record),
      createKeyringSecrets([secret]),
      params.password,
    );
    return { update, keySourceId };
  }

  async prepareInitializePrivateKeySource(
    params: PrivateKeySourceInput & Readonly<{ password: string }>,
  ): Promise<PrivateKeySourceAddition> {
    const { record, secret, accountId } = this.preparePrivateKeySource(params);
    const update = await this.prepareNewVault(
      this.prepareSourceRecords(record),
      createKeyringSecrets([secret]),
      params.password,
    );
    return { update, keySourceId: record.keySourceId, accountId };
  }

  prepareAddBip39Source(
    params: Bip39SourceInput & Readonly<{ removePrivateKeySourceId?: KeySourceId }>,
  ): KeySourceAddition {
    const keySourceId = crypto.randomUUID();
    const secret: KeySourceSecret = { keySourceId, type: "bip39", mnemonic: params.mnemonic };
    const record: KeySource = {
      keySourceId,
      type: "bip39",
      name: params.name,
      backupStatus: params.backupStatus,
      createdAt: params.createdAt,
    };
    const secrets = this.requireUnlocked().secrets;
    const remaining =
      params.removePrivateKeySourceId === undefined
        ? secrets.keySources
        : secrets.keySources.filter((source) => source.keySourceId !== params.removePrivateKeySourceId);
    const update = this.prepareSecretsReplacement(
      this.prepareSourceRecords(record, params.removePrivateKeySourceId),
      createKeyringSecrets([...remaining, secret]),
    );
    return { update, keySourceId };
  }

  prepareAddPrivateKeySource(params: PrivateKeySourceInput): PrivateKeySourceAddition {
    const { record, secret, accountId } = this.preparePrivateKeySource(params);
    const secrets = this.requireUnlocked().secrets;
    const update = this.prepareSecretsReplacement(
      this.prepareSourceRecords(record),
      createKeyringSecrets([...secrets.keySources, secret]),
    );
    return { update, keySourceId: record.keySourceId, accountId };
  }

  prepareRemoveKeySource(keySourceId: KeySourceId): PreparedKeyringUpdate {
    const secrets = this.requireUnlocked().secrets;
    const nextKeySources = new Map(this.#keySources);
    nextKeySources.delete(keySourceId);
    return this.prepareSecretsReplacement(
      { nextKeySources, persistenceChanges: [keySourceWrites.remove(keySourceId)] },
      createKeyringSecrets(secrets.keySources.filter((source) => source.keySourceId !== keySourceId)),
    );
  }

  renameMnemonicSource({ keySourceId, name }: { keySourceId: KeySourceId; name: string }): Promise<void> {
    return this.commitKeySourceUpdate(keySourceId, (source) => {
      if (source.type !== "bip39") throw new Error("Only BIP39 sources have a wallet name.");
      return source.name === name ? null : { ...source, name };
    });
  }

  confirmMnemonicBackup({ keySourceId }: { keySourceId: KeySourceId }): Promise<void> {
    return this.commitKeySourceUpdate(keySourceId, (source) => {
      if (source.type !== "bip39") throw new Error("Backup confirmation requires a BIP39 source.");
      return source.backupStatus === "confirmed" ? null : { ...source, backupStatus: "confirmed" };
    });
  }

  private prepareSourceRecords(record: KeySource, removePrivateKeySourceId?: KeySourceId): RecordUpdate {
    const nextKeySources = new Map(this.#keySources);
    nextKeySources.set(record.keySourceId, record);
    const persistenceChanges: PersistenceChange[] = [keySourceWrites.put(record)];
    if (removePrivateKeySourceId !== undefined) {
      nextKeySources.delete(removePrivateKeySourceId);
      persistenceChanges.push(keySourceWrites.remove(removePrivateKeySourceId));
    }
    return { nextKeySources, persistenceChanges };
  }

  private preparePrivateKeySource(params: PrivateKeySourceInput): Readonly<{
    record: KeySource;
    secret: PrivateKeySourceSecret;
    accountId: AccountId;
  }> {
    const adapter = this.#namespaceAdapters[params.namespace];
    const privateKey = adapter.parsePrivateKey(params.privateKey);
    if (privateKey === null) throw new KeyringInvalidPrivateKeyError(params.namespace);
    try {
      const keySourceId = crypto.randomUUID();
      return {
        record: { keySourceId, type: "private-key", createdAt: params.createdAt },
        secret: { keySourceId, type: "private-key", privateKey: bytesToHex(privateKey) },
        accountId: adapter.accountIdFromPrivateKey(privateKey),
      };
    } finally {
      privateKey.fill(0);
    }
  }

  private createRecordUpdate(records: RecordUpdate): PreparedUpdate {
    return {
      persistenceChanges: records.persistenceChanges,
      activate: () => {
        if (records.nextKeySources) this.#keySources = records.nextKeySources;
      },
      publish: () => {
        if (records.nextKeySources) this.#publishChanged({ type: "keyringChanged" });
      },
    };
  }

  private async prepareNewVault(
    records: RecordUpdate,
    secrets: KeyringSecrets,
    password: string,
  ): Promise<PreparedKeyringUpdate> {
    const plaintext = encodeKeyringSecrets(secrets);
    let vault: UnlockedVault;
    try {
      vault = await createUnlockedVault({ password, plaintext });
    } finally {
      plaintext.fill(0);
    }
    return this.createEncryptedUpdate(records, vault, secrets);
  }

  private prepareSecretsReplacement(records: RecordUpdate, secrets: KeyringSecrets): PreparedKeyringUpdate {
    const plaintext = encodeKeyringSecrets(secrets);
    try {
      return this.createEncryptedUpdate(
        records,
        replaceVaultPlaintext(this.requireUnlocked().vault, plaintext),
        secrets,
      );
    } finally {
      plaintext.fill(0);
    }
  }

  private createEncryptedUpdate(
    records: RecordUpdate,
    vault: UnlockedVault,
    secrets: KeyringSecrets,
  ): PreparedKeyringUpdate {
    const recordUpdate = this.createRecordUpdate(records);
    const previousKey = this.#softwareState.status === "unlocked" ? this.#softwareState.vault.encryptionKey : undefined;
    let activated = false;
    return {
      persistenceChanges: [encryptedVaultWrites.put(vault.record), ...recordUpdate.persistenceChanges],
      activate: () => {
        recordUpdate.activate();
        if (previousKey !== undefined && previousKey !== vault.encryptionKey) previousKey.fill(0);
        this.#softwareState = { status: "unlocked", vault, secrets };
        activated = true;
      },
      publish: recordUpdate.publish,
      discard: () => {
        if (!activated && vault.encryptionKey !== previousKey) vault.encryptionKey.fill(0);
      },
    };
  }

  private async commitKeySourceUpdate(
    keySourceId: KeySourceId,
    change: (source: KeySource) => KeySource | null,
  ): Promise<void> {
    await this.#mutations.run(async (commit) => {
      const source = this.#keySources.get(keySourceId);
      if (!source) throw new KeySourceNotFoundError(keySourceId);
      const nextSource = change(source);
      if (!nextSource) return;
      const nextKeySources = new Map(this.#keySources);
      nextKeySources.set(keySourceId, nextSource);
      await commitUpdates(commit, [
        this.createRecordUpdate({ nextKeySources, persistenceChanges: [keySourceWrites.put(nextSource)] }),
      ]);
    });
  }

  private requireKeySourceSecret(keySourceId: KeySourceId): KeySourceSecret {
    const secret = findKeySourceSecret(this.requireUnlocked().secrets, keySourceId);
    if (!secret) throw new KeySourceNotFoundError(keySourceId);
    return secret;
  }

  private requireUnlocked(): Extract<SoftwareKeyState, { status: "unlocked" }> {
    if (this.#softwareState.status !== "unlocked") throw new Error("Software key material is not unlocked.");
    return this.#softwareState;
  }

  private requireEncryptedRecord(): EncryptedVaultRecord {
    if (this.#softwareState.status === "uninitialized")
      throw new Error("Software key storage has not been initialized.");
    return this.#softwareState.status === "locked" ? this.#softwareState.record : this.#softwareState.vault.record;
  }
}
