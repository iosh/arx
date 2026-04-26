import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import type { TransactionApproveFailureReason } from "../../controllers/transaction/types.js";
import { parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

const requireTransactionSubject = (
  record: Parameters<NonNullable<ApprovalFlow<typeof ApprovalKinds.SendTransaction>["approve"]>>[0],
) => {
  if (record.subject?.kind === "transaction") {
    return record.subject;
  }

  throw new Error(`Send-transaction approval ${record.approvalId} is missing a transaction subject.`);
};

const mapApproveFailureReason = (reason: TransactionApproveFailureReason) => {
  if (reason === "not_found") return ArxReasons.RpcInvalidParams;
  if (reason === "prepare_failed") return ArxReasons.RpcInternal;
  return ArxReasons.RpcInvalidRequest;
};

export const sendTransactionApprovalFlow: ApprovalFlow<typeof ApprovalKinds.SendTransaction> = {
  kind: ApprovalKinds.SendTransaction,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.SendTransaction, input),
  async approve(record, _decision, deps) {
    const transactionId = requireTransactionSubject(record).transactionId;
    const result = await deps.transactions.approveTransaction(transactionId);
    if (result.status === "failed") {
      throw arxError({
        reason: mapApproveFailureReason(result.reason),
        message: result.message,
        data: {
          approvalId: record.approvalId,
          transactionId,
          approveFailure: result.reason,
          ...(result.data !== undefined ? { details: result.data } : {}),
        },
      });
    }

    return result.transaction;
  },
  async onReject(record, input, deps) {
    await deps.transactions.rejectTransaction(requireTransactionSubject(record).transactionId, input.error);
  },
  async onCancel(record, _reason, error, deps) {
    await deps.transactions.rejectTransaction(requireTransactionSubject(record).transactionId, error);
  },
};
