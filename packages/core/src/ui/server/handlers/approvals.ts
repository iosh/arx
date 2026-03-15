import type { ApprovalController, ApprovalResolveInput } from "../../../controllers/approval/types.js";
import type { UiMethodResult } from "../../protocol/index.js";
import type { UiHandlers } from "../types.js";

type UiResolveApprovalResult = UiMethodResult<"ui.approvals.resolve">;
type UiResolvedApproved = Extract<UiResolveApprovalResult, { status: "approved" }>;

export const createApprovalsHandlers = ({
  approvals,
}: {
  approvals: Pick<ApprovalController, "resolve">;
}): Pick<UiHandlers, "ui.approvals.resolve"> => ({
  "ui.approvals.resolve": async (input) => {
    const resolved = await approvals.resolve(input as ApprovalResolveInput);

    if (resolved.status === "approved") {
      return {
        id: resolved.id,
        status: "approved",
        result: resolved.value as UiResolvedApproved["result"],
      } satisfies UiResolveApprovalResult;
    }

    return {
      id: resolved.id,
      status: "rejected",
    } satisfies UiResolveApprovalResult;
  },
});
