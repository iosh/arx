import type { VaultMetaRecord } from "../../db/records.js";

export type VaultMetaChangedHandler = () => void;
export type VaultMetaService = {
  on(event: "changed", handler: VaultMetaChangedHandler): void;
  off(event: "changed", handler: VaultMetaChangedHandler): void;

  get(): Promise<VaultMetaRecord | null>;
  upsert(record: VaultMetaRecord): Promise<void>;
  clear(): Promise<void>;
};
