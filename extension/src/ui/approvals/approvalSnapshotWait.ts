import type { ApprovalSummary, UiSnapshot } from "@arx/core/ui";
import { uiClient } from "@/ui/lib/uiBridgeClient";

const REQUESTED_APPROVAL_TIMEOUT_MS = 2_000;
const ANY_APPROVAL_TIMEOUT_MS = 750;

export const waitForApprovalInSnapshot = async (
  approvalId: string,
  opts?: { requireUnlocked?: boolean; timeoutMs?: number },
): Promise<ApprovalSummary | undefined> => {
  const snapshot = await uiClient.waitForSnapshot({
    timeoutMs: opts?.timeoutMs ?? REQUESTED_APPROVAL_TIMEOUT_MS,
    predicate: (nextSnapshot) =>
      (!opts?.requireUnlocked || nextSnapshot.session.isUnlocked) &&
      nextSnapshot.approvals.some((item) => item.id === approvalId),
  });

  return snapshot.approvals.find((item) => item.id === approvalId);
};

export const waitForAnyApprovalInSnapshot = async (opts?: { timeoutMs?: number }): Promise<UiSnapshot> => {
  return await uiClient.waitForSnapshot({
    timeoutMs: opts?.timeoutMs ?? ANY_APPROVAL_TIMEOUT_MS,
    predicate: (snapshot) => snapshot.session.isUnlocked && snapshot.approvals.length > 0,
  });
};
