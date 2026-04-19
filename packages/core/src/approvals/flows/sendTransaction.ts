import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import { parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const sendTransactionApprovalFlow: ApprovalFlow<typeof ApprovalKinds.SendTransaction> = {
  kind: ApprovalKinds.SendTransaction,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.SendTransaction, input),
  async approve(record, _decision, deps) {
    const approved = await deps.transactions.approveTransaction(record.request.transactionId);
    if (!approved) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "Transaction not found",
        data: { approvalId: record.approvalId, transactionId: record.request.transactionId },
      });
    }

    return approved;
  },
  async onReject(record, input, deps) {
    await deps.transactions.rejectTransaction(record.request.transactionId, input.error);
  },
  async onCancel(record, _reason, error, deps) {
    await deps.transactions.rejectTransaction(record.request.transactionId, error);
  },
};
