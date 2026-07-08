import type { ChainRpcEndpointOverrideRecord } from "../../../storage/records.js";
import type { ChainRef } from "../../ids.js";

export interface ChainRpcEndpointOverridesPort {
  get(chainRef: ChainRef): Promise<ChainRpcEndpointOverrideRecord | null>;
  list(): Promise<ChainRpcEndpointOverrideRecord[]>;
  upsert(record: ChainRpcEndpointOverrideRecord): Promise<void>;
  remove(chainRef: ChainRef): Promise<void>;
  clear(): Promise<void>;
}
