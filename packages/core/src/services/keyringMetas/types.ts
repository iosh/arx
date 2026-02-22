import type { KeyringMetaRecord } from "../../storage/records.js";

export type KeyringMetasChangedHandler = () => void;
export type KeyringMetasService = {
  on(event: "changed", handler: KeyringMetasChangedHandler): void;
  off(event: "changed", handler: KeyringMetasChangedHandler): void;

  get(id: KeyringMetaRecord["id"]): Promise<KeyringMetaRecord | null>;
  list(): Promise<KeyringMetaRecord[]>;

  upsert(record: KeyringMetaRecord): Promise<void>;
  remove(id: KeyringMetaRecord["id"]): Promise<void>;
};
