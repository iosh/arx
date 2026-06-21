import type { ApprovalResolveInput } from "../../approvals/queue/types.js";
import { RpcInvalidParamsError, RpcInvalidRequestError } from "../../rpc/errors.js";
import { buildTransactionTerminalReason } from "../../transactions/index.js";
import type { ResolveApprovalInput, WalletApiApprovalDetailInput } from "../api.js";
import type { WalletApiContext } from "../context.js";
import { WalletApiApprovalsSchemas } from "../schemas/approvals.js";

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
  const params = WalletApiApprovalsSchemas.getDetail.parse(input);
  return await context.approvalDetails.getDetail(params.approvalId);
};

export const resolveApproval = async (context: WalletApiContext, input: ResolveApprovalInput) => {
  const params = WalletApiApprovalsSchemas.resolve.parse(input);
  const transactionApproval = context.transactions.getTransactionApproval(params.approvalId);
  if (!transactionApproval) {
    await context.approvals.resolve(toApprovalResolveInput(params));
    return null;
  }

  if (params.action === "reject") {
    await context.transactions.rejectTransactionApproval({
      approvalId: params.approvalId,
      reason: buildTransactionTerminalReason({
        kind: "user_rejected",
        message: params.reason ?? "User rejected",
        code: "transaction.user_rejected",
      }),
    });
    return null;
  }

  if (!params.expectedPrepareId) {
    throw new RpcInvalidParamsError({
      message: "Send-transaction approval requires expectedPrepareId.",
      details: { approvalId: params.approvalId },
    });
  }

  const result = await context.transactions.approveAndSubmitTransaction({
    approvalId: params.approvalId,
    expectedPrepareId: params.expectedPrepareId,
  });

  if (result.status !== "submitted") {
    throw new RpcInvalidRequestError({
      message: "Transaction approval changed. Review it again.",
      details: { approvalId: params.approvalId, status: result.status },
    });
  }

  return null;
};
