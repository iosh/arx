import type { ChainRpcDefaultEndpointsRecord } from "../../../storage/records.js";
import type { ChainRef } from "../../ids.js";

export interface ChainRpcDefaultEndpointsPort {
  get(chainRef: ChainRef): Promise<ChainRpcDefaultEndpointsRecord | null>;
  list(): Promise<ChainRpcDefaultEndpointsRecord[]>;
  upsert(record: ChainRpcDefaultEndpointsRecord): Promise<void>;
  remove(chainRef: ChainRef): Promise<void>;
  clear(): Promise<void>;
}
