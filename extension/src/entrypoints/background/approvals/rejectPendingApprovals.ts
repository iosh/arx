import type { HandlerControllers } from "@arx/core";
import { ApprovalTypes, ArxReasons, arxError } from "@arx/core";

export const rejectPendingApprovals = async (
  controllers: Pick<HandlerControllers, "approvals" | "transactions">,
  params: { reason: string; details?: Record<string, unknown> },
): Promise<void> => {
  const pending = controllers.approvals.getState().pending;
  if (pending.length === 0) return;

  const snapshot = [...pending];
  for (const item of snapshot) {
    const error = arxError({
      reason: ArxReasons.ApprovalRejected,
      message: "User rejected the request.",
      data: { reason: params.reason, id: item.id, origin: item.origin, type: item.type, ...params.details },
    });

    if (item.type === ApprovalTypes.SendTransaction) {
      try {
        await controllers.transactions.rejectTransaction(item.id, error);
      } catch {
        // Best-effort; we still want to unblock the pending approval.
      }
    }

    controllers.approvals.reject(item.id, error);
  }
};
