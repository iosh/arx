import type {
  CustomNetworksReader,
  NetworkRpcOverridesReader,
  NetworkSelectionReader,
  ProviderChainSelectionsReader,
} from "@arx/core/persistence";
import type { DexiePersistenceContext } from "../database.js";
import { networkSelectionFromRow } from "../mappers/singletons.js";
import { NETWORK_SELECTION_ROW_KEY } from "../rows.js";

export const createCustomNetworksReader = (context: DexiePersistenceContext): CustomNetworksReader => ({
  listAll() {
    return context.read(async () => {
      await context.ready;
      return await context.db.customNetworks.toArray();
    });
  },
});

export const createNetworkRpcOverridesReader = (context: DexiePersistenceContext): NetworkRpcOverridesReader => ({
  listAll() {
    return context.read(async () => {
      await context.ready;
      return await context.db.networkRpcOverrides.toArray();
    });
  },
});

export const createNetworkSelectionReader = (context: DexiePersistenceContext): NetworkSelectionReader => ({
  get() {
    return context.read(async () => {
      await context.ready;
      const row = await context.db.networkSelection.get(NETWORK_SELECTION_ROW_KEY);
      return row ? networkSelectionFromRow(row) : null;
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
