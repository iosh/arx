import type { KeyringMetaRecord } from "../../storage/records.js";

export interface KeyringMetasPort {
  get(id: KeyringMetaRecord["id"]): Promise<KeyringMetaRecord | null>;
  list(): Promise<KeyringMetaRecord[]>;

  upsert(record: KeyringMetaRecord): Promise<void>;
  remove(id: KeyringMetaRecord["id"]): Promise<void>;
}
