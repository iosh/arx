import type { UiSnapshot } from "@arx/core/ui";
import type { EntryIntent } from "@/ui/lib/entryIntent";
import { getApprovalRoutePath } from "./routes";

export type ApprovalAttentionAction =
  | { type: "noop" }
  | { type: "reset" }
  | { type: "close" }
  | { type: "waitForRequestedApproval" }
  | { type: "waitForAnyApproval" }
  | { type: "navigate"; to: string };

export function getCurrentApprovalRouteId(pathname: string): string | null {
  const pathMatch = /^\/approve\/[^/]+\/([^/]+)$/.exec(pathname);
  return pathMatch?.[1] ?? null;
}

export function getApprovalAttentionAction(params: {
  snapshot: UiSnapshot | undefined;
  isLoading: boolean;
  entryIntent: EntryIntent;
  pathname: string;
  requestedApprovalId: string | null;
  hadApprovalsSinceUnlock: boolean;
}): {
  action: ApprovalAttentionAction;
  nextHadApprovalsSinceUnlock: boolean;
} {
  const { snapshot, isLoading, entryIntent, pathname, requestedApprovalId, hadApprovalsSinceUnlock } = params;

  if (isLoading || !snapshot) {
    return { action: { type: "noop" }, nextHadApprovalsSinceUnlock: hadApprovalsSinceUnlock };
  }

  if (entryIntent !== "attention_open" || !snapshot.vault.initialized) {
    return { action: { type: "noop" }, nextHadApprovalsSinceUnlock: hadApprovalsSinceUnlock };
  }

  if (!snapshot.session.isUnlocked) {
    return { action: { type: "reset" }, nextHadApprovalsSinceUnlock: false };
  }

  const nextHadApprovalsSinceUnlock = hadApprovalsSinceUnlock || snapshot.approvals.length > 0;
  if (snapshot.approvals.length === 0) {
    if (nextHadApprovalsSinceUnlock) {
      return { action: { type: "close" }, nextHadApprovalsSinceUnlock };
    }

    if (requestedApprovalId) {
      return { action: { type: "waitForRequestedApproval" }, nextHadApprovalsSinceUnlock };
    }

    return { action: { type: "waitForAnyApproval" }, nextHadApprovalsSinceUnlock };
  }

  const currentApprovalId = getCurrentApprovalRouteId(pathname);
  if (currentApprovalId && snapshot.approvals.some((item) => item.id === currentApprovalId)) {
    return { action: { type: "noop" }, nextHadApprovalsSinceUnlock };
  }

  if (requestedApprovalId) {
    const requestedApproval = snapshot.approvals.find((item) => item.id === requestedApprovalId);
    if (requestedApproval) {
      return {
        action: { type: "navigate", to: getApprovalRoutePath(requestedApproval) },
        nextHadApprovalsSinceUnlock,
      };
    }
  }

  return {
    action: { type: "navigate", to: getApprovalRoutePath(snapshot.approvals[0]) },
    nextHadApprovalsSinceUnlock,
  };
}
