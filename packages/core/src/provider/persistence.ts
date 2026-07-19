import type { ChainRef } from "../networks/chainRef.js";
import { defineKeyedPersistenceType, type KeyedPersistenceType } from "../persistence/definition.js";
import type { OriginNamespaceKey } from "../persistence/keys.js";

export type ProviderChainSelectionRecord = Readonly<{
  origin: string;
  namespace: string;
  chainRef: ChainRef;
}>;

export interface ProviderChainSelectionsReader {
  get(key: OriginNamespaceKey): Promise<ProviderChainSelectionRecord | null>;
  listByOrigin(origin: string): Promise<ProviderChainSelectionRecord[]>;
  listByChainRef(chainRef: ChainRef): Promise<ProviderChainSelectionRecord[]>;
  listAll(): Promise<ProviderChainSelectionRecord[]>;
}

export const providerChainSelectionPersistenceType: KeyedPersistenceType<
  "providerChainSelection",
  ProviderChainSelectionRecord,
  OriginNamespaceKey
> = defineKeyedPersistenceType<"providerChainSelection", ProviderChainSelectionRecord, OriginNamespaceKey>(
  "providerChainSelection",
);
