import type { ChainRef } from "../../../chains/ids.js";
import type { CustomChainRecord } from "../../../storage/records.js";

export interface CustomChainsPort {
  get(chainRef: ChainRef): Promise<CustomChainRecord | null>;
  list(): Promise<CustomChainRecord[]>;
  upsert(record: CustomChainRecord): Promise<void>;
  remove(chainRef: ChainRef): Promise<void>;
  clear(): Promise<void>;
}
