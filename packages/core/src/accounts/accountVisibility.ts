import type { AccountGroupRecord } from "./persistence.js";

/** Finds the first other visible account from the same recovery source, in the supplied order. */
export function findAccountHideReplacement(
  account: AccountGroupRecord,
  accounts: readonly AccountGroupRecord[],
): AccountGroupRecord | null {
  if (account.source.type !== "bip39") return null;
  const { keySourceId } = account.source;
  return (
    accounts.find(
      (candidate) =>
        candidate.accountGroupId !== account.accountGroupId &&
        !candidate.hidden &&
        candidate.source.type === "bip39" &&
        candidate.source.keySourceId === keySourceId,
    ) ?? null
  );
}
