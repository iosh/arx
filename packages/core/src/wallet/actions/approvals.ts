import { RpcInvalidParamsError, RpcInvalidRequestError } from "../../rpc/errors.js";
import { buildTransactionTerminalReason } from "../../transactions/index.js";
import type { DismissApprovalInput, ResolveApprovalInput, WalletApiApprovalDetailInput } from "../api.js";
import type { WalletApiContext } from "../context.js";

export const listPendingApprovals = async (context: WalletApiContext) => await context.approvalDetails.listPending();

export const getApprovalDetail = async (context: WalletApiContext, input: WalletApiApprovalDetailInput) => {
  return await context.approvalDetails.getDetail(input.approvalId);
};

export const dismissApproval = async (context: WalletApiContext, input: DismissApprovalInput) => {
  const transactionApproval = context.transactions.getTransactionApproval(input.approvalId);
  if (!transactionApproval) {
    await context.approvals.cancel({
      approvalId: input.approvalId,
      reason: "user_dismissed",
    });
    return null;
  }

  await context.transactions.cancelTransactionApproval({
    approvalId: input.approvalId,
    reason: buildTransactionTerminalReason({
      kind: "approval_cancelled",
      code: "approval.user_dismissed",
      message: "Approval dismissed by user.",
      details: { reason: "user_dismissed" },
    }),
  });
  return null;
};

export const resolveApproval = async (context: WalletApiContext, input: ResolveApprovalInput) => {
  const transactionApproval = context.transactions.getTransactionApproval(input.approvalId);
  if (!transactionApproval) {
    await context.approvals.resolve(input);
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
