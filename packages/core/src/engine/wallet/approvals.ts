import type { ApprovalController } from "../../controllers/approval/types.js";
import type { WalletApprovals } from "../types.js";

export const createWalletApprovals = (deps: { approvals: ApprovalController }): WalletApprovals => {
  const { approvals } = deps;

  return {
    getState: () => approvals.getState(),
    get: (id) => approvals.get(id),
    listPending: () =>
      approvals.getState().pending.flatMap((item) => {
        const record = approvals.get(item.approvalId);
        return record ? [record] : [];
      }),
    create: (request, requester) => approvals.create(request, requester),
    resolve: (input) => approvals.resolve(input),
    cancel: (input) => approvals.cancel(input),
    cancelByScope: (input) => approvals.cancelByScope(input),
    onStateChanged: (listener) => approvals.onStateChanged(listener),
    onCreated: (listener) => approvals.onCreated(listener),
    onFinished: (listener) => approvals.onFinished(listener),
  };
};
