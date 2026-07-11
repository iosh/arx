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
  async listAll() {
    await context.ready;
    return await context.db.customChains.toArray();
  },
});

export const createChainRpcOverridesReader = (context: DexiePersistenceContext): ChainRpcOverridesReader => ({
  async listAll() {
    await context.ready;
    return await context.db.chainRpcOverrides.toArray();
  },
});

export const createWalletChainSelectionReader = (context: DexiePersistenceContext): WalletChainSelectionReader => ({
  async get() {
    await context.ready;
    const row = await context.db.walletChainSelection.get(WALLET_CHAIN_SELECTION_ROW_KEY);
    return row ? walletChainSelectionFromRow(row) : null;
  },
});

export const createProviderChainSelectionsReader = (
  context: DexiePersistenceContext,
): ProviderChainSelectionsReader => ({
  async get(key) {
    await context.ready;
    return (await context.db.providerChainSelections.get([key.origin, key.namespace])) ?? null;
  },

  async listByOrigin(origin) {
    await context.ready;
    return await context.db.providerChainSelections.where("origin").equals(origin).toArray();
  },

  async listByChainRef(chainRef) {
    await context.ready;
    return await context.db.providerChainSelections.where("chainRef").equals(chainRef).toArray();
  },

  async listAll() {
    await context.ready;
    return await context.db.providerChainSelections.toArray();
  },
});
