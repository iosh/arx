import type { ChainRef } from "../../../chains/ids.js";
import type { ChainRpcDefaultEndpointsRecord } from "../../../storage/records.js";

export interface ChainRpcDefaultEndpointsPort {
  get(chainRef: ChainRef): Promise<ChainRpcDefaultEndpointsRecord | null>;
  list(): Promise<ChainRpcDefaultEndpointsRecord[]>;
  upsert(record: ChainRpcDefaultEndpointsRecord): Promise<void>;
  remove(chainRef: ChainRef): Promise<void>;
  clear(): Promise<void>;
}
