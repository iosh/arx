import type { AccountsReader } from "@arx/core/persistence";
import type { DexiePersistenceContext } from "../database.js";
import { ACCOUNT_SELECTION_ROW_KEY } from "../rows.js";

export const createAccountsReader = (context: DexiePersistenceContext): AccountsReader => ({
  listGroups() {
    return context.read(async () => {
      await context.ready;
      return await context.db.accountGroups.toArray();
    });
  },
  listRecords() {
    return context.read(async () => {
      await context.ready;
      return await context.db.accounts.toArray();
    });
  },

  getSelection() {
    return context.read(async () => {
      await context.ready;
      const row = await context.db.accountSelection.get(ACCOUNT_SELECTION_ROW_KEY);
      return row ? { accountGroupId: row.accountGroupId } : null;
    });
  },
});
