import type { DappNetworkSelectionsReader } from "@arx/core/persistence";
import type { DexiePersistenceContext } from "../database.js";

export const createDappNetworkSelectionsReader = (context: DexiePersistenceContext): DappNetworkSelectionsReader => ({
  listAll() {
    return context.read(async () => {
      await context.ready;
      return await context.db.dappNetworkSelections.toArray();
    });
  },
});
