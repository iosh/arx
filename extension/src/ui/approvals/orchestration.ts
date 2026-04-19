import type { ApprovalListEntry } from "@arx/core/ui";
import type { UiEntryMetadata } from "@/lib/uiEntryMetadata";
import { ROUTES } from "@/ui/lib/routes";
import { getApprovalRoutePath } from "./routes";

export type ApprovalAttentionAction =
  | { type: "noop" }
  | { type: "reset" }
  | { type: "close" }
  | { type: "navigate"; to: string };

export function getCurrentApprovalRouteId(pathname: string): string | null {
  const pathMatch = /^\/approve\/([^/]+)$/.exec(pathname);
  return pathMatch?.[1] ?? null;
}

export function getApprovalAttentionAction(params: {
  approvals: ApprovalListEntry[] | undefined;
  isLoading: boolean;
  entry: UiEntryMetadata;
  pathname: string;
  requestedApprovalId: string | null;
  hadApprovalsSinceUnlock: boolean;
}): {
  action: ApprovalAttentionAction;
  nextHadApprovalsSinceUnlock: boolean;
} {
  const { approvals, isLoading, entry, pathname, requestedApprovalId, hadApprovalsSinceUnlock } = params;

  if (isLoading || !approvals) {
    return { action: { type: "noop" }, nextHadApprovalsSinceUnlock: hadApprovalsSinceUnlock };
  }

  if (entry.environment !== "notification") {
    return { action: { type: "noop" }, nextHadApprovalsSinceUnlock: hadApprovalsSinceUnlock };
  }

  if (entry.reason === "idle") {
    return { action: { type: "close" }, nextHadApprovalsSinceUnlock: false };
  }

  if (entry.reason !== "approval_created" && entry.reason !== "unlock_required") {
    return { action: { type: "noop" }, nextHadApprovalsSinceUnlock: false };
  }

  const nextHadApprovalsSinceUnlock = hadApprovalsSinceUnlock || approvals.length > 0;
  if (approvals.length === 0) {
    if (nextHadApprovalsSinceUnlock) {
      return { action: { type: "close" }, nextHadApprovalsSinceUnlock };
    }

    if (pathname === ROUTES.APPROVALS) {
      return { action: { type: "noop" }, nextHadApprovalsSinceUnlock };
    }

    return { action: { type: "navigate", to: ROUTES.APPROVALS }, nextHadApprovalsSinceUnlock };
  }

  const currentApprovalId = getCurrentApprovalRouteId(pathname);
  if (currentApprovalId && approvals.some((item) => item.approvalId === currentApprovalId)) {
    return { action: { type: "noop" }, nextHadApprovalsSinceUnlock };
  }

  if (requestedApprovalId) {
    const requestedApproval = approvals.find((item) => item.approvalId === requestedApprovalId);
    if (requestedApproval) {
      return {
        action: { type: "navigate", to: getApprovalRoutePath(requestedApproval.approvalId) },
        nextHadApprovalsSinceUnlock,
      };
    }
  }

  return {
    action: { type: "navigate", to: getApprovalRoutePath(approvals[0].approvalId) },
    nextHadApprovalsSinceUnlock,
  };
}
