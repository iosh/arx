import type { AccountSelectionRecord, AccountsReader } from "@arx/core/persistence";
import type { DexiePersistenceContext } from "../database.js";
import { accountFromRow } from "../mappers/accounts.js";

export const createAccountsReader = (context: DexiePersistenceContext): AccountsReader => ({
  get(accountId) {
    return context.read(async () => {
      await context.ready;
      const row = await context.db.accounts.get(accountId);
      return row ? accountFromRow(row) : null;
    });
  },

  getMany(accountIds) {
    return context.read(async () => {
      await context.ready;
      if (accountIds.length === 0) return [];
      const rows = await context.db.accounts.bulkGet([...accountIds]);
      return rows.flatMap((row) => (row ? [accountFromRow(row)] : []));
    });
  },

  getNamespaceAccounts(namespace) {
    return context.read(async () => {
      await context.ready;
      return await context.db.transaction("r", context.db.accounts, context.db.accountSelections, async () => {
        const rows = await context.db.accounts.where("namespace").equals(namespace).toArray();
        if (rows.length === 0) return null;

        const selection = await context.db.accountSelections.get(namespace);
        return {
          accounts: rows.map(accountFromRow),
          selection: selection as AccountSelectionRecord,
        };
      });
    });
  },

  listByKeyringIds(keyringIds) {
    return context.read(async () => {
      await context.ready;
      if (keyringIds.length === 0) return [];
      const rows = await context.db.accounts
        .where("hdKeyringId")
        .anyOf([...keyringIds])
        .toArray();
      return rows.map(accountFromRow);
    });
  },

  listByPrivateKeySourceIds(keySourceIds) {
    return context.read(async () => {
      await context.ready;
      if (keySourceIds.length === 0) return [];
      const rows = await context.db.accounts
        .where("privateKeySourceId")
        .anyOf([...keySourceIds])
        .toArray();
      return rows.map(accountFromRow);
    });
  },

  listIds() {
    return context.read(async () => {
      await context.ready;
      return await context.db.accounts.toCollection().primaryKeys();
    });
  },
});
