import type { ChainRef } from "../chains/ids.js";
import type { NetworkRpcPreferenceRecord } from "../db/records.js";
import type { VaultMetaSnapshot } from "./schemas.js";

export interface NetworkRpcPort {
  get(chainRef: ChainRef): Promise<NetworkRpcPreferenceRecord | null>;
  getAll(): Promise<NetworkRpcPreferenceRecord[]>;
  upsert(record: NetworkRpcPreferenceRecord): Promise<void>;
  upsertMany(records: NetworkRpcPreferenceRecord[]): Promise<void>;
  remove(chainRef: ChainRef): Promise<void>;
  clear(): Promise<void>;
}

export interface VaultMetaPort {
  loadVaultMeta(): Promise<VaultMetaSnapshot | null>;
  saveVaultMeta(envelope: VaultMetaSnapshot): Promise<void>;
  clearVaultMeta(): Promise<void>;
}
