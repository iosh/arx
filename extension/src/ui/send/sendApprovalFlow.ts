import type { UiMethodParams } from "@arx/core/ui";
import type { QueryClient } from "@tanstack/react-query";
import { uiClient } from "@/ui/lib/uiBridgeClient";
import { waitForUiSnapshotMatch } from "@/ui/lib/uiSnapshotQuery";

const SEND_APPROVAL_TIMEOUT_MS = 2_000;

export const SEND_APPROVAL_NOT_READY_ERROR = "Send request was created but is not visible in the wallet yet.";

export type SendApprovalInput = UiMethodParams<"ui.transactions.requestSendTransactionApproval">;

/**
 * Waits until the requested send approval is visible in an unlocked UI snapshot.
 * Returns `false` when the approval cannot be observed before the timeout/fallback completes.
 */
export async function waitForRequestedSendApproval(queryClient: QueryClient, approvalId: string): Promise<boolean> {
  const snapshot = await waitForUiSnapshotMatch(
    queryClient,
    (nextSnapshot) => nextSnapshot.session.isUnlocked && nextSnapshot.approvals.some((item) => item.id === approvalId),
    { timeoutMs: SEND_APPROVAL_TIMEOUT_MS },
  );

  return snapshot?.approvals.some((item) => item.id === approvalId) ?? false;
}

/**
 * Creates a send approval, waits for it to become visible to the popup, then
 * hands control over to the canonical approval detail route.
 */
export async function requestSendApprovalAndNavigate(params: {
  queryClient: QueryClient;
  input: SendApprovalInput;
  navigateToApprovalRoute: (approvalId: string) => Promise<void>;
}): Promise<string> {
  const { queryClient, input, navigateToApprovalRoute } = params;

  const { approvalId } = await uiClient.transactions.requestSendTransactionApproval(input);
  const approvalVisible = await waitForRequestedSendApproval(queryClient, approvalId);
  if (!approvalVisible) {
    throw new Error(SEND_APPROVAL_NOT_READY_ERROR);
  }

  await navigateToApprovalRoute(approvalId);
  return approvalId;
}
