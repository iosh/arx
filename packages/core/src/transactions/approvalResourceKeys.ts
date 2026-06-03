import type { TransactionAggregate } from "./aggregate/index.js";
import type { TransactionApprovalResourceKey } from "./namespace/types.js";

export const deriveApprovalResourceKeyFromAggregate = (
  aggregate: Pick<TransactionAggregate, "record">,
): TransactionApprovalResourceKey | null => {
  if (aggregate.record.conflictKey?.kind !== "eip155.nonce") {
    return null;
  }

  return {
    kind: "eip155.account_nonce",
    value: `${aggregate.record.chainRef}:${aggregate.record.accountKey}`,
  };
};
