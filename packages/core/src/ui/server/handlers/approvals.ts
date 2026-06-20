import type { TrustedWalletApi } from "../../../wallet/api.js";
import type { UiHandlers } from "../types.js";

export const createApprovalsHandlers = ({
  wallet,
}: {
  wallet: TrustedWalletApi;
}): Pick<UiHandlers, "ui.approvals.listPending" | "ui.approvals.getDetail" | "ui.approvals.resolve"> => ({
  "ui.approvals.listPending": async () => await wallet.approvals.listPending(),
  "ui.approvals.getDetail": async (input) => await wallet.approvals.getDetail(input),
  "ui.approvals.resolve": async (input) => {
    await wallet.approvals.resolve(input);
    return null;
  },
});
