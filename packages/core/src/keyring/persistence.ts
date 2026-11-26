import { defineKeyedPersistenceType, type KeyedPersistenceType } from "../persistence/definition.js";
import type { KeySource, KeySourceId } from "./types.js";

export type { BackupStatus, KeySourceId } from "./types.js";

export interface KeySourcesReader {
  listAll(): Promise<readonly KeySource[]>;
}

export const keySourceWrites: KeyedPersistenceType<"keySource", KeySource, KeySourceId> = defineKeyedPersistenceType<
  "keySource",
  KeySource,
  KeySourceId
>("keySource");
