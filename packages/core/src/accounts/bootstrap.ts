import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { AccountRecord, AccountSelectionRecord } from "./persistence.js";

export type AccountsBootstrap = Readonly<{
  records: readonly AccountRecord[];
  selections: readonly AccountSelectionRecord[];
}>;

export const loadAccountsBootstrap = async (
  readers: Pick<CorePersistenceReaders, "accounts">,
): Promise<AccountsBootstrap> => {
  const [records, selections] = await Promise.all([readers.accounts.listRecords(), readers.accounts.listSelections()]);

  return { records, selections };
};
