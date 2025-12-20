import type { Dexie, Transaction } from "dexie";

export type MigrationContext = {
  db: Dexie;
  transaction: Transaction;
};

export const runMigrations = async (_context: MigrationContext): Promise<void> => {
  // no-op placeholder for future schema migrations
};
