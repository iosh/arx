import type { ChainRef } from "../networks/chainRef.js";
import type { ChainDefinition, NonEmptyRpcEndpoints } from "../networks/types.js";
import {
  defineKeyedPersistenceType,
  defineSingletonPersistenceType,
  type KeyedPersistenceType,
  type SingletonPersistenceType,
} from "../persistence/definition.js";
export type CustomChainRecord = Readonly<{
  definition: ChainDefinition;
  defaultRpcEndpoints: NonEmptyRpcEndpoints;
  createAt: number;
}>;

export interface CustomChainsReader {
  listAll(): Promise<CustomChainRecord[]>;
}

export const customChainPersistenceType: KeyedPersistenceType<"customChain", CustomChainRecord, ChainRef> =
  defineKeyedPersistenceType<"customChain", CustomChainRecord, ChainRef>("customChain");

export type ChainRpcOverrideRecord = Readonly<{
  chainRef: ChainRef;
  endpoints: NonEmptyRpcEndpoints;
}>;

export interface ChainRpcOverridesReader {
  listAll(): Promise<ChainRpcOverrideRecord[]>;
}

export const chainRpcOverridePersistenceType: KeyedPersistenceType<
  "chainRpcOverride",
  ChainRpcOverrideRecord,
  ChainRef
> = defineKeyedPersistenceType<"chainRpcOverride", ChainRpcOverrideRecord, ChainRef>("chainRpcOverride");

export type WalletChainSelectionRecord = Readonly<{
  activeNamespace: string;
  chainRefByNamespace: Readonly<Record<string, ChainRef>>;
}>;

export interface WalletChainSelectionReader {
  get(): Promise<WalletChainSelectionRecord | null>;
}

export const walletChainSelectionPersistenceType: SingletonPersistenceType<
  "walletChainSelection",
  WalletChainSelectionRecord
> = defineSingletonPersistenceType<"walletChainSelection", WalletChainSelectionRecord>("walletChainSelection");
