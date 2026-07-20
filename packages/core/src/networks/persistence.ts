import type { Namespace } from "../namespaces/types.js";
import {
  defineKeyedPersistenceType,
  defineSingletonPersistenceType,
  type KeyedPersistenceType,
  type SingletonPersistenceType,
} from "../persistence/definition.js";
import type { ChainRef } from "./chainRef.js";
import type { ChainDefinition, NonEmptyRpcEndpoints } from "./types.js";

export type CustomNetworkRecord = Readonly<{
  definition: ChainDefinition;
  defaultRpcEndpoints: NonEmptyRpcEndpoints;
}>;

export interface CustomNetworksReader {
  listAll(): Promise<CustomNetworkRecord[]>;
}

export const customNetworkPersistenceType: KeyedPersistenceType<"customNetwork", CustomNetworkRecord, ChainRef> =
  defineKeyedPersistenceType<"customNetwork", CustomNetworkRecord, ChainRef>("customNetwork");

export type NetworkRpcOverrideRecord = Readonly<{
  chainRef: ChainRef;
  endpoints: NonEmptyRpcEndpoints;
}>;

export interface NetworkRpcOverridesReader {
  listAll(): Promise<NetworkRpcOverrideRecord[]>;
}

export const networkRpcOverridePersistenceType: KeyedPersistenceType<
  "networkRpcOverride",
  NetworkRpcOverrideRecord,
  ChainRef
> = defineKeyedPersistenceType<"networkRpcOverride", NetworkRpcOverrideRecord, ChainRef>("networkRpcOverride");

export type NetworkSelectionRecord = Readonly<{
  selectedNamespace: Namespace;
  selectedChainRefByNamespace: Readonly<Record<Namespace, ChainRef>>;
}>;

export interface NetworkSelectionReader {
  get(): Promise<NetworkSelectionRecord | null>;
}

export const networkSelectionPersistenceType: SingletonPersistenceType<"networkSelection", NetworkSelectionRecord> =
  defineSingletonPersistenceType<"networkSelection", NetworkSelectionRecord>("networkSelection");
