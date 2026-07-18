import type { AccountsReader } from "@arx/core/persistence";
import type { DexiePersistenceContext } from "../database.js";

export const createAccountsReader = (context: DexiePersistenceContext): AccountsReader => ({
  listRecords() {
    return context.read(async () => {
      await context.ready;
      return await context.db.accounts.toArray();
    });
  },

  listSelections() {
    return context.read(async () => {
      await context.ready;
      return await context.db.accountSelections.toArray();
    });
  },
});
