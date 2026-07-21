import type { CustomNetworksReader, NetworkRpcOverridesReader, NetworkSelectionReader } from "@arx/core/persistence";
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
