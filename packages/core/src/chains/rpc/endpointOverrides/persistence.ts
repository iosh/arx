import { defineKeyedPersistenceType, type KeyedPersistenceType } from "../../../persistence/definition.js";
import type { RpcEndpoint } from "../../definition.js";
import type { ChainRef } from "../../ids.js";

export type ChainRpcOverrideRecord = Readonly<{
  chainRef: ChainRef;
  endpoints: readonly [RpcEndpoint, ...RpcEndpoint[]];
}>;

export interface ChainRpcOverridesReader {
  listAll(): Promise<ChainRpcOverrideRecord[]>;
}

export const chainRpcOverridePersistenceType: KeyedPersistenceType<
  "chainRpcOverride",
  ChainRpcOverrideRecord,
  ChainRef
> = defineKeyedPersistenceType<"chainRpcOverride", ChainRpcOverrideRecord, ChainRef>("chainRpcOverride");
