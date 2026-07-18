import { persistenceChange } from "../persistence/change.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import type { KeyringBootstrap } from "./bootstrap.js";
import {
  HdKeyringAlreadyExistsError,
  HdKeyringNotFoundError,
  HdKeyringRequiresBip39SourceError,
  KeySourceBackupUnsupportedError,
  KeySourceNotFoundError,
  KeySourceRequiresHdKeyringError,
} from "./errors.js";
import {
  type Bip39KeySourceRecord,
  type HdKeyringId,
  type HdKeyringRecord,
  hdKeyringPersistenceType,
  type KeySourceId,
  type KeySourceRecord,
  keySourcePersistenceType,
  type PrivateKeySourceRecord,
} from "./persistence.js";
import type { KeyringSecrets } from "./secrets.js";

export type KeyringChanged = Readonly<{
  type: "keyringChanged";
}>;

type KeyringUpdate = Readonly<{
  nextKeySources: ReadonlyMap<KeySourceId, KeySourceRecord>;
  nextHdKeyrings: ReadonlyMap<HdKeyringId, HdKeyringRecord>;
  persistenceChanges: readonly PersistenceChange[];
}>;

const EMPTY_BOOTSTRAP: KeyringBootstrap = { keySources: [], hdKeyrings: [] };

const sharesDerivationSequence = (left: HdKeyringRecord, right: HdKeyringRecord): boolean =>
  left.keySourceId === right.keySourceId &&
  left.namespace === right.namespace &&
  left.derivationProfileId === right.derivationProfileId;

/** Owns key source/HD keyring records and decoded secrets for the current runtime. */
export class Keyring {
  #keySources: ReadonlyMap<KeySourceId, KeySourceRecord>;
  #hdKeyrings: ReadonlyMap<HdKeyringId, HdKeyringRecord>;
  #secrets: KeyringSecrets | null = null;

  constructor(bootstrap: KeyringBootstrap = EMPTY_BOOTSTRAP) {
    this.#keySources = new Map(bootstrap.keySources.map((source) => [source.keySourceId, source]));
    this.#hdKeyrings = new Map(bootstrap.hdKeyrings.map((hdKeyring) => [hdKeyring.hdKeyringId, hdKeyring]));
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

  getSecrets(): KeyringSecrets | null {
    return this.#secrets;
  }

  activateSecrets(secrets: KeyringSecrets): void {
    this.#secrets = secrets;
  }

  lock(): void {
    this.#secrets = null;
  }

  prepareAddBip39Source(params: {
    source: Bip39KeySourceRecord;
    hdKeyring: Omit<HdKeyringRecord, "keySourceId">;
  }): KeyringUpdate {
    const hdKeyring: HdKeyringRecord = {
      ...params.hdKeyring,
      keySourceId: params.source.keySourceId,
    };

    const nextKeySources = new Map(this.#keySources);
    nextKeySources.set(params.source.keySourceId, params.source);

    const nextHdKeyrings = new Map(this.#hdKeyrings);
    nextHdKeyrings.set(hdKeyring.hdKeyringId, hdKeyring);

    const persistenceChanges = [
      persistenceChange.put(keySourcePersistenceType, params.source),
      persistenceChange.put(hdKeyringPersistenceType, hdKeyring),
    ];

    return { nextKeySources, nextHdKeyrings, persistenceChanges };
  }

  prepareAddPrivateKeySource(source: PrivateKeySourceRecord): KeyringUpdate {
    const nextKeySources = new Map(this.#keySources);
    nextKeySources.set(source.keySourceId, source);

    const persistenceChanges = [persistenceChange.put(keySourcePersistenceType, source)];

    return { nextKeySources, nextHdKeyrings: this.#hdKeyrings, persistenceChanges };
  }

  prepareConfirmBackup(keySourceId: KeySourceId): KeyringUpdate | null {
    const source = this.#keySources.get(keySourceId);
    if (!source) throw new KeySourceNotFoundError(keySourceId);
    if (source.type !== "bip39") throw new KeySourceBackupUnsupportedError(keySourceId);
    if (source.backupStatus === "confirmed") return null;

    const confirmedSource = { ...source, backupStatus: "confirmed" } as const;
    const nextKeySources = new Map(this.#keySources);
    nextKeySources.set(keySourceId, confirmedSource);

    const persistenceChanges = [persistenceChange.put(keySourcePersistenceType, confirmedSource)];

    return { nextKeySources, nextHdKeyrings: this.#hdKeyrings, persistenceChanges };
  }

  prepareAddHdKeyring(hdKeyring: HdKeyringRecord): KeyringUpdate {
    this.assertBip39Source(hdKeyring.keySourceId);
    const existing = [...this.#hdKeyrings.values()].find((candidate) => sharesDerivationSequence(candidate, hdKeyring));
    if (existing) {
      throw new HdKeyringAlreadyExistsError({
        existingHdKeyringId: existing.hdKeyringId,
        keySourceId: hdKeyring.keySourceId,
        namespace: hdKeyring.namespace,
        derivationProfileId: hdKeyring.derivationProfileId,
      });
    }

    const nextHdKeyrings = new Map(this.#hdKeyrings);
    nextHdKeyrings.set(hdKeyring.hdKeyringId, hdKeyring);

    const persistenceChanges = [persistenceChange.put(hdKeyringPersistenceType, hdKeyring)];

    return { nextKeySources: this.#keySources, nextHdKeyrings, persistenceChanges };
  }

  prepareAdvanceHdKeyring(hdKeyringId: HdKeyringId): KeyringUpdate {
    const current = this.#hdKeyrings.get(hdKeyringId);
    if (!current) throw new HdKeyringNotFoundError(hdKeyringId);

    const advanced = { ...current, nextDerivationIndex: current.nextDerivationIndex + 1 };
    const nextHdKeyrings = new Map(this.#hdKeyrings);
    nextHdKeyrings.set(hdKeyringId, advanced);

    const persistenceChanges = [persistenceChange.put(hdKeyringPersistenceType, advanced)];

    return { nextKeySources: this.#keySources, nextHdKeyrings, persistenceChanges };
  }

  prepareRemoveHdKeyring(hdKeyringId: HdKeyringId): KeyringUpdate {
    const current = this.#hdKeyrings.get(hdKeyringId);
    if (!current) throw new HdKeyringNotFoundError(hdKeyringId);

    const sourceHdKeyrings = this.listHdKeyringsByKeySourceIds([current.keySourceId]);
    if (sourceHdKeyrings.length === 1) throw new KeySourceRequiresHdKeyringError(current.keySourceId);

    const nextHdKeyrings = new Map(this.#hdKeyrings);
    nextHdKeyrings.delete(hdKeyringId);

    const persistenceChanges = [persistenceChange.remove(hdKeyringPersistenceType, hdKeyringId)];

    return { nextKeySources: this.#keySources, nextHdKeyrings, persistenceChanges };
  }

  prepareRemoveKeySource(keySourceId: KeySourceId): KeyringUpdate {
    const source = this.#keySources.get(keySourceId);
    if (!source) throw new KeySourceNotFoundError(keySourceId);

    const removedHdKeyrings = this.listHdKeyringsByKeySourceIds([keySourceId]);
    const nextKeySources = new Map(this.#keySources);
    nextKeySources.delete(keySourceId);

    const nextHdKeyrings = new Map(this.#hdKeyrings);
    for (const hdKeyring of removedHdKeyrings) nextHdKeyrings.delete(hdKeyring.hdKeyringId);

    const persistenceChanges = [
      persistenceChange.remove(keySourcePersistenceType, keySourceId),
      ...removedHdKeyrings.map((hdKeyring) =>
        persistenceChange.remove(hdKeyringPersistenceType, hdKeyring.hdKeyringId),
      ),
    ];

    return { nextKeySources, nextHdKeyrings, persistenceChanges };
  }

  prepareReset(): KeyringUpdate {
    const keySources = this.listKeySources();
    const hdKeyrings = this.listHdKeyrings();

    const persistenceChanges = [
      ...keySources.map((source) => persistenceChange.remove(keySourcePersistenceType, source.keySourceId)),
      ...hdKeyrings.map((hdKeyring) => persistenceChange.remove(hdKeyringPersistenceType, hdKeyring.hdKeyringId)),
    ];

    return {
      nextKeySources: new Map(),
      nextHdKeyrings: new Map(),
      persistenceChanges,
    };
  }

  applyCommittedUpdate(update: KeyringUpdate): void {
    this.#keySources = update.nextKeySources;
    this.#hdKeyrings = update.nextHdKeyrings;
  }

  private assertBip39Source(keySourceId: KeySourceId): void {
    const source = this.#keySources.get(keySourceId);
    if (!source) throw new KeySourceNotFoundError(keySourceId);
    if (source.type !== "bip39") throw new HdKeyringRequiresBip39SourceError(keySourceId);
  }
}
