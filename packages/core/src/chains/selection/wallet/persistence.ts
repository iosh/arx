import { defineSingletonPersistenceType, type SingletonPersistenceType } from "../../../persistence/definition.js";
import type { ChainRef } from "../../ids.js";

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
