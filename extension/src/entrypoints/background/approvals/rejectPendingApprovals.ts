import type { HandlerControllers } from "@arx/core";
import { ApprovalKinds, type ApprovalTerminalReason, ArxReasons, arxError, getApprovalType } from "@arx/core";

const toArxReason = (reason: ApprovalTerminalReason) => {
  switch (reason) {
    case "locked":
      return ArxReasons.SessionLocked;
    case "session_lost":
      return ArxReasons.TransportDisconnected;
    case "timeout":
      return ArxReasons.ApprovalTimeout;
    case "internal_error":
      return ArxReasons.RpcInternal;
    case "user_approve":
    case "user_reject":
    case "window_closed":
    case "replaced":
      return ArxReasons.ApprovalRejected;
  }
};

export const rejectPendingApprovals = async (
  controllers: Pick<HandlerControllers, "approvals" | "transactions">,
  params: { reason: ApprovalTerminalReason; details?: Record<string, unknown> },
): Promise<void> => {
  const pending = controllers.approvals.getState().pending;
  if (pending.length === 0) return;

  const snapshot = [...pending];
  for (const item of snapshot) {
    const error = arxError({
      reason: toArxReason(params.reason),
      message: "Request cancelled.",
      data: {
        reason: params.reason,
        id: item.id,
        origin: item.origin,
        type: getApprovalType(item.kind),
        ...params.details,
      },
    });

    if (item.kind === ApprovalKinds.SendTransaction) {
      try {
        await controllers.transactions.rejectTransaction(item.id, error);
      } catch {
        // Best-effort; we still want to unblock the pending approval.
      }
    }

    await controllers.approvals.cancel({ id: item.id, reason: params.reason, error });
  }
};
