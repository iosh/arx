import type {
  ChainRpcOverridesReader,
  CustomChainsReader,
  ProviderChainSelectionsReader,
  WalletChainSelectionReader,
} from "@arx/core/persistence";
import type { DexiePersistenceContext } from "../database.js";
import { walletChainSelectionFromRow } from "../mappers/singletons.js";
import { WALLET_CHAIN_SELECTION_ROW_KEY } from "../rows.js";

export const createCustomChainsReader = (context: DexiePersistenceContext): CustomChainsReader => ({
  listAll() {
    return context.read(async () => {
      await context.ready;
      return await context.db.customChains.toArray();
    });
  },
});

export const createChainRpcOverridesReader = (context: DexiePersistenceContext): ChainRpcOverridesReader => ({
  listAll() {
    return context.read(async () => {
      await context.ready;
      return await context.db.chainRpcOverrides.toArray();
    });
  },
});

export const createWalletChainSelectionReader = (context: DexiePersistenceContext): WalletChainSelectionReader => ({
  get() {
    return context.read(async () => {
      await context.ready;
      const row = await context.db.walletChainSelection.get(WALLET_CHAIN_SELECTION_ROW_KEY);
      return row ? walletChainSelectionFromRow(row) : null;
    });
  },
});

export const createProviderChainSelectionsReader = (
  context: DexiePersistenceContext,
): ProviderChainSelectionsReader => ({
  get(key) {
    return context.read(async () => {
      await context.ready;
      return (await context.db.providerChainSelections.get([key.origin, key.namespace])) ?? null;
    });
  },

  listByOrigin(origin) {
    return context.read(async () => {
      await context.ready;
      return await context.db.providerChainSelections.where("origin").equals(origin).toArray();
    });
  },

  listByChainRef(chainRef) {
    return context.read(async () => {
      await context.ready;
      return await context.db.providerChainSelections.where("chainRef").equals(chainRef).toArray();
    });
  },

  listAll() {
    return context.read(async () => {
      await context.ready;
      return await context.db.providerChainSelections.toArray();
    });
  },
});
