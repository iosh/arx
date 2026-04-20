import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../controllers/approval/types.js";
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

export const sendTransactionApprovalFlow: ApprovalFlow<typeof ApprovalKinds.SendTransaction> = {
  kind: ApprovalKinds.SendTransaction,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.SendTransaction, input),
  async approve(record, _decision, deps) {
    const transactionId = requireTransactionSubject(record).transactionId;
    const approved = await deps.transactions.approveTransaction(transactionId);
    if (!approved) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "Transaction not found",
        data: { approvalId: record.approvalId, transactionId },
      });
    }

    return approved;
  },
  async onReject(record, input, deps) {
    await deps.transactions.rejectTransaction(requireTransactionSubject(record).transactionId, input.error);
  },
  async onCancel(record, _reason, error, deps) {
    await deps.transactions.rejectTransaction(requireTransactionSubject(record).transactionId, error);
  },
};
