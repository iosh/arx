import type { AccountGroupRecord } from "./persistence.js";

/** Finds the first other visible group from the same recovery source, in the supplied order. */
export function findAccountHideReplacement(
  group: AccountGroupRecord,
  groups: readonly AccountGroupRecord[],
): AccountGroupRecord | null {
  const { keySourceId } = group.source;
  return (
    groups.find(
      (candidate) =>
        candidate.accountGroupId !== group.accountGroupId &&
        !candidate.hidden &&
        candidate.source.type === "bip39" &&
        candidate.source.keySourceId === keySourceId,
    ) ?? null
  );
}
