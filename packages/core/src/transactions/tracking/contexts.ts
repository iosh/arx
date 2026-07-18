import type { Accounts } from "../../accounts/Accounts.js";
import type { TransactionAggregate } from "../aggregate/index.js";
import type { TransactionTrackingContext } from "../namespace/types.js";
import { SubmittedTransactionTrackingInvariantError } from "./errors.js";

export const buildSubmittedTransactionTrackingContext = (
  aggregate: TransactionAggregate,
  accounts: Pick<Accounts, "getAddress">,
): TransactionTrackingContext => {
  if (aggregate.record.status !== "submitted") {
    throw new SubmittedTransactionTrackingInvariantError(
      aggregate.record.id,
      `Transaction "${aggregate.record.id}" is not submitted.`,
    );
  }

  if (aggregate.record.submitted === null) {
    throw new SubmittedTransactionTrackingInvariantError(
      aggregate.record.id,
      `Submitted transaction "${aggregate.record.id}" is missing submitted facts.`,
    );
  }

  const acceptedSubmission = aggregate.submissions.find((submission) => submission.status === "accepted");
  if (!acceptedSubmission) {
    throw new SubmittedTransactionTrackingInvariantError(
      aggregate.record.id,
      `Submitted transaction "${aggregate.record.id}" has no accepted submission.`,
    );
  }

  return {
    recordId: aggregate.record.id,
    namespace: aggregate.record.namespace,
    chainRef: aggregate.record.chainRef,
    origin: aggregate.record.origin,
    from: accounts.getAddress({
      chainRef: aggregate.record.chainRef,
      accountId: aggregate.record.accountId,
    }).canonicalAddress,
    submitted: structuredClone(aggregate.record.submitted),
  };
};
