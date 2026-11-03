import { defineKeyedPersistenceType, type KeyedPersistenceType } from "../persistence/definition.js";
import type { ChainRef } from "./chainRef.js";
import type { ChainDefinition, NonEmptyRpcEndpoints } from "./types.js";

export type CustomNetworkRecord = Readonly<{
  definition: ChainDefinition;
  defaultRpcEndpoints: NonEmptyRpcEndpoints;
}>;

export interface CustomNetworksReader {
  listAll(): Promise<CustomNetworkRecord[]>;
}

export const customNetworkWrites: KeyedPersistenceType<"customNetwork", CustomNetworkRecord, ChainRef> =
  defineKeyedPersistenceType<"customNetwork", CustomNetworkRecord, ChainRef>("customNetwork");

export type NetworkRpcOverrideRecord = Readonly<{
  chainRef: ChainRef;
  endpoints: NonEmptyRpcEndpoints;
}>;

export interface NetworkRpcOverridesReader {
  listAll(): Promise<NetworkRpcOverrideRecord[]>;
}

export const networkRpcOverrideWrites: KeyedPersistenceType<"networkRpcOverride", NetworkRpcOverrideRecord, ChainRef> =
  defineKeyedPersistenceType<"networkRpcOverride", NetworkRpcOverrideRecord, ChainRef>("networkRpcOverride");
