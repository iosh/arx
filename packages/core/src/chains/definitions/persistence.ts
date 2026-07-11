import { defineKeyedPersistenceType, type KeyedPersistenceType } from "../../persistence/definition.js";
import type { ChainDefinition, RpcEndpoint } from "../definition.js";
import type { ChainRef } from "../ids.js";

export type CustomChainRecord = Readonly<{
  definition: ChainDefinition;
  defaultRpcEndpoints: readonly [RpcEndpoint, ...RpcEndpoint[]];
}>;

export interface CustomChainsReader {
  listAll(): Promise<CustomChainRecord[]>;
}

export const customChainPersistenceType: KeyedPersistenceType<"customChain", CustomChainRecord, ChainRef> =
  defineKeyedPersistenceType<"customChain", CustomChainRecord, ChainRef>("customChain");
