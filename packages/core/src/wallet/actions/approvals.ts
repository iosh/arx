import type { DismissApprovalInput, ResolveApprovalInput, WalletApiApprovalDetailInput } from "../api.js";
import type { WalletApiContext } from "../context.js";

export const listPendingApprovals = async (context: WalletApiContext) => {
  return await context.approvalDetails.listPending();
};

export const getApprovalDetail = async (context: WalletApiContext, input: WalletApiApprovalDetailInput) => {
  return await context.approvalDetails.getDetail(input.approvalId);
};

export const dismissApproval = async (context: WalletApiContext, input: DismissApprovalInput) => {
  await context.approvals.cancel({
    approvalId: input.approvalId,
    reason: "user_dismissed",
  });
  return null;
};

export const resolveApproval = async (context: WalletApiContext, input: ResolveApprovalInput) => {
  await context.approvals.resolve(input);
  return null;
};
