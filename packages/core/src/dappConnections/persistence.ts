import type { Namespace } from "../namespaces/types.js";
import type { ChainRef } from "../networks/chainRef.js";
import { defineKeyedPersistenceType, type KeyedPersistenceType } from "../persistence/definition.js";

export type DappConnectionScope = Readonly<{
  origin: string;
  namespace: Namespace;
}>;

export type DappNetworkSelectionRecord = Readonly<{
  origin: string;
  namespace: Namespace;
  chainRef: ChainRef;
}>;

export interface DappNetworkSelectionsReader {
  listAll(): Promise<readonly DappNetworkSelectionRecord[]>;
}

export const dappNetworkSelectionPersistenceType: KeyedPersistenceType<
  "dappNetworkSelection",
  DappNetworkSelectionRecord,
  DappConnectionScope
> = defineKeyedPersistenceType<"dappNetworkSelection", DappNetworkSelectionRecord, DappConnectionScope>(
  "dappNetworkSelection",
);
