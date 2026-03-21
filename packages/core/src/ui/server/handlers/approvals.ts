import type { ApprovalController, ApprovalResolveInput } from "../../../controllers/approval/types.js";
import type { UiMethodResult } from "../../protocol/index.js";
import type { UiHandlers } from "../types.js";

type UiResolveApprovalResult = UiMethodResult<"ui.approvals.resolve">;

export const createApprovalsHandlers = ({
  approvals,
}: {
  approvals: Pick<ApprovalController, "resolve">;
}): Pick<UiHandlers, "ui.approvals.resolve"> => ({
  "ui.approvals.resolve": async (input) =>
    (await approvals.resolve(input as ApprovalResolveInput)) as UiResolveApprovalResult,
});
