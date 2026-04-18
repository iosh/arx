import type { ChainRef } from "../../../chains/ids.js";
import type { CustomRpcRecord } from "../../../storage/records.js";

export interface CustomRpcPort {
  get(chainRef: ChainRef): Promise<CustomRpcRecord | null>;
  list(): Promise<CustomRpcRecord[]>;
  upsert(record: CustomRpcRecord): Promise<void>;
  remove(chainRef: ChainRef): Promise<void>;
  clear(): Promise<void>;
}
