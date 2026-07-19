import { defineKeyedPersistenceType, type KeyedPersistenceType } from "../persistence/definition.js";

export type KeySourceId = string;
export type HdKeyringId = string;
export type BackupStatus = "pending" | "confirmed";

export type Bip39KeySourceRecord = Readonly<{
  keySourceId: KeySourceId;
  type: "bip39";
  backupStatus: BackupStatus;
  createdAt: number;
}>;

export type PrivateKeySourceRecord = Readonly<{
  keySourceId: KeySourceId;
  type: "private-key";
  namespace: string;
  createdAt: number;
}>;

export type KeySourceRecord = Bip39KeySourceRecord | PrivateKeySourceRecord;

export type HdKeyringRecord = Readonly<{
  hdKeyringId: HdKeyringId;
  keySourceId: KeySourceId;
  namespace: string;
  /** Monotonic index reserved for the next HD derivation. */
  nextDerivationIndex: number;
  createdAt: number;
}>;

export interface KeySourcesReader {
  listAll(): Promise<KeySourceRecord[]>;
}

export interface HdKeyringsReader {
  listAll(): Promise<HdKeyringRecord[]>;
}

export const keySourcePersistenceType: KeyedPersistenceType<"keySource", KeySourceRecord, KeySourceId> =
  defineKeyedPersistenceType<"keySource", KeySourceRecord, KeySourceId>("keySource");

export const hdKeyringPersistenceType: KeyedPersistenceType<"hdKeyring", HdKeyringRecord, HdKeyringId> =
  defineKeyedPersistenceType<"hdKeyring", HdKeyringRecord, HdKeyringId>("hdKeyring");
