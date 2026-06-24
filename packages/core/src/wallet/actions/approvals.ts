import type { ApprovalResolveInput } from "../../approvals/queue/types.js";
import { RpcInvalidParamsError, RpcInvalidRequestError } from "../../rpc/errors.js";
import { buildTransactionTerminalReason } from "../../transactions/index.js";
import type { ResolveApprovalInput, WalletApiApprovalDetailInput } from "../api.js";
import type { WalletApiContext } from "../context.js";

const toApprovalResolveInput = (input: ResolveApprovalInput): ApprovalResolveInput => {
  if (input.action === "approve") {
    return input.decision === undefined
      ? { approvalId: input.approvalId, action: "approve" }
      : { approvalId: input.approvalId, action: "approve", decision: input.decision };
  }

  return input.reason === undefined
    ? { approvalId: input.approvalId, action: "reject" }
    : { approvalId: input.approvalId, action: "reject", reason: input.reason };
};

export const listPendingApprovals = async (context: WalletApiContext) => await context.approvalDetails.listPending();

export const getApprovalDetail = async (context: WalletApiContext, input: WalletApiApprovalDetailInput) => {
  return await context.approvalDetails.getDetail(input.approvalId);
};

export const resolveApproval = async (context: WalletApiContext, input: ResolveApprovalInput) => {
  const transactionApproval = context.transactions.getTransactionApproval(input.approvalId);
  if (!transactionApproval) {
    await context.approvals.resolve(toApprovalResolveInput(input));
    return null;
  }

  if (input.action === "reject") {
    await context.transactions.rejectTransactionApproval({
      approvalId: input.approvalId,
      reason: buildTransactionTerminalReason({
        kind: "user_rejected",
        message: input.reason ?? "User rejected",
        code: "transaction.user_rejected",
      }),
    });
    return null;
  }

  if (!input.expectedPrepareId) {
    throw new RpcInvalidParamsError({
      message: "Send-transaction approval requires expectedPrepareId.",
      details: { approvalId: input.approvalId },
    });
  }

  const result = await context.transactions.approveAndSubmitTransaction({
    approvalId: input.approvalId,
    expectedPrepareId: input.expectedPrepareId,
  });

  if (result.status !== "submitted") {
    throw new RpcInvalidRequestError({
      message: "Transaction approval changed. Review it again.",
      details: { approvalId: input.approvalId, status: result.status },
    });
  }

  return null;
};
