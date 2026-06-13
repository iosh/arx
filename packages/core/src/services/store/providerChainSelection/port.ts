import type { ProviderChainSelectionRecord } from "../../../storage/records.js";

export interface ProviderChainSelectionPort {
  get(params: { origin: string; namespace: string }): Promise<ProviderChainSelectionRecord | null>;
  listAll(): Promise<ProviderChainSelectionRecord[]>;
  upsert(record: ProviderChainSelectionRecord): Promise<void>;
  remove(params: { origin: string; namespace: string }): Promise<void>;
}
