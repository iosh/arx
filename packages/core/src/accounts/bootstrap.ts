import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { AccountGroupRecord, AccountMemberRecord, AccountSelectionRecord } from "./persistence.js";

export type AccountsBootstrap = Readonly<{
  groups: readonly AccountGroupRecord[];
  records: readonly AccountMemberRecord[];
  selection: AccountSelectionRecord | null;
}>;

export const loadAccountsBootstrap = async (
  readers: Pick<CorePersistenceReaders, "accounts">,
): Promise<AccountsBootstrap> => {
  const [groups, records, selection] = await Promise.all([
    readers.accounts.listGroups(),
    readers.accounts.listRecords(),
    readers.accounts.getSelection(),
  ]);

  return { groups, records, selection };
};
