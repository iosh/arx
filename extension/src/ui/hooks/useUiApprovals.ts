import type { ApprovalDetail, ApprovalListEntry } from "@arx/core/wallet";
import { useQuery } from "@tanstack/react-query";
import { app } from "@/ui/lib/app";
import { createUiApprovalDetailQueryOptions, UI_APPROVALS_LIST_QUERY_KEY } from "@/ui/lib/uiApprovalQueries";

export function useUiApprovalsList() {
  const query = useQuery<ApprovalListEntry[]>({
    queryKey: UI_APPROVALS_LIST_QUERY_KEY,
    queryFn: async (): Promise<ApprovalListEntry[]> => await app.wallet.approvals.listPending(),
    // Approval queries are fully event-driven; background events own invalidation.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return {
    approvals: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}

export function useUiApprovalDetail(approvalId: string) {
  const query = useQuery<ApprovalDetail | null>({
    ...createUiApprovalDetailQueryOptions(approvalId),
  });

  return {
    detail: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}
