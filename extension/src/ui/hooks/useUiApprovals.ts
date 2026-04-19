import {
  type ApprovalDetail,
  type ApprovalListEntry,
  UI_EVENT_APPROVAL_DETAIL_CHANGED,
  UI_EVENT_APPROVALS_CHANGED,
} from "@arx/core/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  createUiApprovalDetailQueryOptions,
  UI_APPROVALS_LIST_QUERY_KEY,
  uiApprovalDetailQueryKey,
} from "@/ui/lib/uiApprovalQueries";
import { uiClient } from "@/ui/lib/uiBridgeClient";

export function useUiApprovalsList() {
  const queryClient = useQueryClient();
  const query = useQuery<ApprovalListEntry[]>({
    queryKey: UI_APPROVALS_LIST_QUERY_KEY,
    queryFn: async (): Promise<ApprovalListEntry[]> => await uiClient.approvals.listPending(),
    // Approval queries are fully event-driven; background events own invalidation.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    const unsubscribe = uiClient.on(UI_EVENT_APPROVALS_CHANGED, () => {
      void queryClient.invalidateQueries({ queryKey: UI_APPROVALS_LIST_QUERY_KEY });
    });

    return () => unsubscribe();
  }, [queryClient]);

  return {
    approvals: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}

export function useUiApprovalDetail(approvalId: string) {
  const queryClient = useQueryClient();
  const query = useQuery<ApprovalDetail | null>({
    ...createUiApprovalDetailQueryOptions(approvalId),
  });

  useEffect(() => {
    const unsubscribe = uiClient.on(UI_EVENT_APPROVAL_DETAIL_CHANGED, (payload) => {
      if (payload.approvalId !== approvalId) {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: uiApprovalDetailQueryKey(approvalId) });
    });

    return () => unsubscribe();
  }, [approvalId, queryClient]);

  return {
    detail: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}
