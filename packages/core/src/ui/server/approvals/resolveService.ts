import type { ApprovalResolveInput, ApprovalResolveResult } from "../../../approvals/queue/types.js";
import { buildTransactionTerminalReason } from "../../../transactions/index.js";
import type { TransactionsService } from "../../../transactions/TransactionsService.js";
import type { UiMethodParams } from "../../protocol/index.js";

type ApprovalResolveRequest = UiMethodParams<"ui.approvals.resolve">;

export type UiApprovalResolveResult =
  | {
      status: "resolved";
    }
  | {
      status: "requires_review";
      approvalId: string;
    };

type ApprovalResolveServiceDeps = {
  approvals: {
    resolve(input: ApprovalResolveInput): Promise<ApprovalResolveResult>;
  };
  transactions: Pick<
    TransactionsService,
    "getTransactionApproval" | "approveAndSubmitTransaction" | "rejectTransactionApproval"
  >;
};

const toApprovalResolveInput = (input: ApprovalResolveRequest): ApprovalResolveInput => {
  if (input.action === "approve") {
    return input.decision === undefined
      ? { approvalId: input.approvalId, action: "approve" }
      : { approvalId: input.approvalId, action: "approve", decision: input.decision };
  }

  return input.reason === undefined
    ? { approvalId: input.approvalId, action: "reject" }
    : { approvalId: input.approvalId, action: "reject", reason: input.reason };
};

export const createApprovalResolveService = (deps: ApprovalResolveServiceDeps) => ({
  async resolve(input: ApprovalResolveRequest): Promise<UiApprovalResolveResult> {
    const transactionApproval = deps.transactions.getTransactionApproval(input.approvalId);
    if (!transactionApproval) {
      await deps.approvals.resolve(toApprovalResolveInput(input));
      return { status: "resolved" };
    }

    if (input.action === "reject") {
      await deps.transactions.rejectTransactionApproval({
        approvalId: input.approvalId,
        reason: buildTransactionTerminalReason({
          kind: "user_rejected",
          message: input.reason ?? "User rejected",
          code: "transaction.user_rejected",
        }),
      });
      return { status: "resolved" };
    }

    if (!input.expectedPrepareId) {
      throw new Error("Send-transaction approval requires expectedPrepareId.");
    }

    const result = await deps.transactions.approveAndSubmitTransaction({
      approvalId: input.approvalId,
      expectedPrepareId: input.expectedPrepareId,
    });

    return result.status === "submitted"
      ? { status: "resolved" }
      : { status: "requires_review", approvalId: input.approvalId };
  },
});
