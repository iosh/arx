import { defineKeyedPersistenceType, type KeyedPersistenceType } from "../persistence/definition.js";

export type KeySourceId = string;
export type KeyringId = string;
export type DerivationProfileId = string;
export type BackupStatus = "pending" | "confirmed";

export type Bip39KeySourceRecord = Readonly<{
  keySourceId: KeySourceId;
  type: "bip39";
  backupStatus: BackupStatus;
  createAt: number;
}>;

export type PrivateKeySourceRecord = Readonly<{
  keySourceId: KeySourceId;
  type: "private-key";
  namespace: string;
  createAt: number;
}>;

export type KeySourceRecord = Bip39KeySourceRecord | PrivateKeySourceRecord;

export type HdKeyringRecord = Readonly<{
  keyringId: KeyringId;
  keySourceId: KeySourceId;
  namespace: string;
  derivationProfileId: DerivationProfileId;
  /** Monotonic index reserved for the next HD derivation. */
  nextDerivationIndex: number;
  createAt: number;
}>;

export interface KeySourcesReader {
  get(keySourceId: KeySourceId): Promise<KeySourceRecord | null>;
  listAll(): Promise<KeySourceRecord[]>;
}

export interface HdKeyringsReader {
  get(keyringId: KeyringId): Promise<HdKeyringRecord | null>;
  listByKeySourceIds(keySourceIds: readonly KeySourceId[]): Promise<HdKeyringRecord[]>;
  listByNamespace(namespace: string): Promise<HdKeyringRecord[]>;
  listAll(): Promise<HdKeyringRecord[]>;
}

export const keySourcePersistenceType: KeyedPersistenceType<"keySource", KeySourceRecord, KeySourceId> =
  defineKeyedPersistenceType<"keySource", KeySourceRecord, KeySourceId>("keySource");

export const hdKeyringPersistenceType: KeyedPersistenceType<"hdKeyring", HdKeyringRecord, KeyringId> =
  defineKeyedPersistenceType<"hdKeyring", HdKeyringRecord, KeyringId>("hdKeyring");
