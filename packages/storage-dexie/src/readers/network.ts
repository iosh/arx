import type { CustomNetworksReader, NetworkRpcOverridesReader } from "@arx/core/persistence";
import type { DexiePersistenceContext } from "../database.js";

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
