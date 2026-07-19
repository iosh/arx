import { defineKeyedPersistenceType, type KeyedPersistenceType } from "../persistence/definition.js";
import type { HdKeyring, HdKeyringId, KeySource, KeySourceId } from "./types.js";

export type { BackupStatus, HdKeyringId, KeySourceId } from "./types.js";

export type Bip39KeySourceRecord = Extract<KeySource, { type: "bip39" }>;

export type PrivateKeySourceRecord = Extract<KeySource, { type: "private-key" }>;

export type KeySourceRecord = KeySource;

export type HdKeyringRecord = HdKeyring;

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
