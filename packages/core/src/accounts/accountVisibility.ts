import type { AccountRecord } from "./persistence.js";

/** Finds the first other visible account in the same HD keyring, following the supplied account order. */
export function findAccountHideReplacement(
  account: AccountRecord,
  accounts: readonly AccountRecord[],
): AccountRecord | null {
  if (account.origin.type !== "hd") return null;
  const { hdKeyringId } = account.origin;
  return (
    accounts.find(
      (candidate) =>
        candidate.accountId !== account.accountId &&
        !candidate.hidden &&
        candidate.origin.type === "hd" &&
        candidate.origin.hdKeyringId === hdKeyringId,
    ) ?? null
  );
}
