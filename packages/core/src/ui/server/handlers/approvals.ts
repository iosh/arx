import type { ApprovalController, ApprovalResolveInput } from "../../../controllers/approval/types.js";
import type { UiMethodResult } from "../../protocol/index.js";
import type { UiHandlers, UiPlatformAdapter } from "../types.js";

type UiResolveApprovalResult = UiMethodResult<"ui.approvals.resolve">;
type UiApprovalPopupResult = UiMethodResult<"ui.approvals.openPopup">;

export const createApprovalsHandlers = ({
  approvals,
  platform,
}: {
  approvals: Pick<ApprovalController, "resolve">;
  platform: Pick<UiPlatformAdapter, "openNotificationPopup">;
}): Pick<UiHandlers, "ui.approvals.openPopup" | "ui.approvals.resolve"> => ({
  "ui.approvals.openPopup": async () => (await platform.openNotificationPopup()) as UiApprovalPopupResult,
  "ui.approvals.resolve": async (input) =>
    (await approvals.resolve(input as ApprovalResolveInput)) as UiResolveApprovalResult,
});
