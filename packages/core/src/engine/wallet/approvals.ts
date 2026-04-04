import { createApprovalFlowRegistry } from "../../approvals/index.js";
import { toUnsupportedApprovalSummary } from "../../approvals/presentation.js";
import type { ApprovalSummary } from "../../approvals/summary.js";
import type { ApprovalController, ApprovalQueueItem } from "../../controllers/approval/types.js";
import type { TransactionController } from "../../controllers/transaction/types.js";
import type { ChainViewsService } from "../../services/runtime/chainViews/types.js";
import type { WalletAccounts, WalletApprovals } from "../types.js";

const buildPendingSummary = (
  item: ApprovalQueueItem,
  deps: {
    getSummary: (id: string) => ApprovalSummary | undefined;
  },
): ApprovalSummary => {
  const summary = deps.getSummary(item.id);
  return summary ?? toUnsupportedApprovalSummary(item);
};

export const createWalletApprovals = (deps: {
  approvals: ApprovalController;
  accounts: Pick<WalletAccounts, "getActiveAccountForNamespace" | "listOwnedForNamespace">;
  chainViews: Pick<ChainViewsService, "getApprovalReviewChainView" | "findAvailableChainView">;
  transactions: Pick<TransactionController, "getMeta">;
}): WalletApprovals => {
  const { approvals, accounts, chainViews, transactions } = deps;
  const approvalFlows = createApprovalFlowRegistry();

  const getSummary = (id: string): ApprovalSummary | undefined => {
    const record = approvals.get(id);
    if (!record) {
      return undefined;
    }

    return approvalFlows.present(record, {
      accounts,
      chainViews,
      transactions,
    });
  };

  return {
    getState: () => approvals.getState(),
    get: (id) => approvals.get(id),
    listPending: () =>
      approvals.getState().pending.flatMap((item) => {
        const record = approvals.get(item.id);
        return record ? [record] : [];
      }),
    getSummary: (id) => {
      const summary = getSummary(id);
      if (summary) {
        return summary;
      }

      const pendingItem = approvals.getState().pending.find((item) => item.id === id);
      return pendingItem ? toUnsupportedApprovalSummary(pendingItem) : undefined;
    },
    listPendingSummaries: () =>
      approvals.getState().pending.map((item) =>
        buildPendingSummary(item, {
          getSummary,
        }),
      ),
    create: (request, requester) => approvals.create(request, requester),
    resolve: (input) => approvals.resolve(input),
    cancel: (input) => approvals.cancel(input),
    cancelByScope: (input) => approvals.cancelByScope(input),
    onStateChanged: (listener) => approvals.onStateChanged(listener),
    onCreated: (listener) => approvals.onCreated(listener),
    onFinished: (listener) => approvals.onFinished(listener),
  };
};
