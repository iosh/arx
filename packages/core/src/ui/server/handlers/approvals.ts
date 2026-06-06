import type { UiApprovalsAccess, UiHandlers } from "../types.js";

export const createApprovalsHandlers = ({
  approvals,
}: {
  approvals: UiApprovalsAccess;
}): Pick<UiHandlers, "ui.approvals.listPending" | "ui.approvals.getDetail" | "ui.approvals.resolve"> => ({
  "ui.approvals.listPending": async () => approvals.read.listPendingEntries(),
  "ui.approvals.getDetail": async ({ approvalId }) => approvals.read.getDetail(approvalId),
  "ui.approvals.resolve": async (input) => {
    const result = await approvals.write.resolve(input);
    if (result.status === "requires_review") {
      throw new Error("Transaction approval changed. Review it again.");
    }
    return null;
  },
});
