import type { CoreReadApi } from "../../../read/types.js";
import type { TrustedWalletApi } from "../../../wallet/api.js";
import type { UiHandlers } from "../types.js";

export const createApprovalsHandlers = ({
  wallet,
  read,
}: {
  wallet: TrustedWalletApi;
  read: CoreReadApi;
}): Pick<UiHandlers, "ui.approvals.listPending" | "ui.approvals.getDetail" | "ui.approvals.resolve"> => ({
  "ui.approvals.listPending": async () => await read.listPendingApprovals(),
  "ui.approvals.getDetail": async (input) => await read.getApprovalDetail(input),
  "ui.approvals.resolve": async (input) => {
    await wallet.resolveApproval(input);
    return null;
  },
});
