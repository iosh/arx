import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { AccountGroupRecord, AccountSelectionRecord } from "./persistence.js";

export type AccountsBootstrap = Readonly<{
  groups: readonly AccountGroupRecord[];
  selection: AccountSelectionRecord | null;
}>;

export const loadAccountsBootstrap = async (
  readers: Pick<CorePersistenceReaders, "accounts">,
): Promise<AccountsBootstrap> => {
  const [groups, selection] = await Promise.all([readers.accounts.listGroups(), readers.accounts.getSelection()]);

  return { groups, selection };
};
