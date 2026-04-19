import type { ApprovalController, ApprovalResolveInput } from "../../../controllers/approval/types.js";
import type { UiMethodResult } from "../../protocol/index.js";
import type { UiApprovalsAccess, UiHandlers } from "../types.js";

export const createApprovalsHandlers = ({
  approvals,
}: {
  approvals: UiApprovalsAccess;
}): Pick<UiHandlers, "ui.approvals.listPending" | "ui.approvals.getDetail" | "ui.approvals.resolve"> => ({
  "ui.approvals.listPending": async () => approvals.read.listPendingEntries(),
  "ui.approvals.getDetail": async ({ approvalId }) => approvals.read.getDetail(approvalId),
  "ui.approvals.resolve": async (input) => {
    await approvals.write.resolve(input as ApprovalResolveInput);
    return null;
  },
});
