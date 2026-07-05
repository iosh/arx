import type { ApprovalFinalStatus, ApprovalFinishedErrorSummary, ApprovalTerminalReason } from "./types.js";

export { createDeferred, type Deferred } from "../../utils/deferred.js";

export const serializeApprovalFinishedError = (error: unknown): ApprovalFinishedErrorSummary => {
  const err = error instanceof Error ? error : new Error(String(error));
  const code = "code" in err && typeof err.code === "string" ? err.code : undefined;
  return {
    name: err.name || "Error",
    message: err.message || "Unknown error",
    ...(code !== undefined ? { code } : {}),
  };
};

export const deriveApprovalFinalStatus = (terminalReason: ApprovalTerminalReason): ApprovalFinalStatus => {
  switch (terminalReason) {
    case "user_approve":
      return "approved";
    case "user_reject":
      return "rejected";
    case "timeout":
      return "expired";
    case "internal_error":
      return "failed";
    case "locked":
    case "caller_disconnected":
    case "user_dismissed":
    case "superseded":
    case "runtime_shutdown":
      return "cancelled";
  }
};
