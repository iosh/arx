import type { ApprovalDetails } from "../../approvals/approvalDetails.js";
import type { WalletApprovals } from "../../engine/types.js";
import type { DismissApprovalInput, ResolveApprovalInput, WalletApiApprovalDetailInput } from "../api.js";

export const createApprovalsHandlers = (deps: { approvals: WalletApprovals; approvalDetails: ApprovalDetails }) => ({
  listPending: async () => await deps.approvalDetails.listPending(),
  getDetail: async (input: WalletApiApprovalDetailInput) => await deps.approvalDetails.getDetail(input.approvalId),
  dismiss: async (input: DismissApprovalInput) => {
    await deps.approvals.cancel({
      approvalId: input.approvalId,
      reason: "user_dismissed",
    });
    return null;
  },
  resolve: async (input: ResolveApprovalInput) => {
    await deps.approvals.resolve(input);
    return null;
  },
});
