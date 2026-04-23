import type { ApprovalDetail } from "@arx/core/ui";
import type { QueryClient } from "@tanstack/react-query";
import { uiClient } from "@/ui/lib/uiBridgeClient";

export const UI_APPROVALS_LIST_QUERY_KEY = ["uiApprovals", "list"] as const;
export const uiApprovalDetailQueryKey = (approvalId: string) => ["uiApprovals", "detail", approvalId] as const;

export const createUiApprovalDetailQueryOptions = (approvalId: string) => ({
  queryKey: uiApprovalDetailQueryKey(approvalId),
  queryFn: async (): Promise<ApprovalDetail | null> => await uiClient.approvals.getDetail({ approvalId }),
  // Approval queries are fully event-driven; background events own invalidation.
  staleTime: Infinity,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
});

export const loadUiApprovalDetailIntoCache = async (
  queryClient: QueryClient,
  approvalId: string,
): Promise<ApprovalDetail | null> => {
  return await queryClient.fetchQuery(createUiApprovalDetailQueryOptions(approvalId));
};

export const writeCachedUiApprovalDetail = (
  queryClient: QueryClient,
  params: { approvalId: string; detail: ApprovalDetail },
): ApprovalDetail => {
  queryClient.setQueryData(uiApprovalDetailQueryKey(params.approvalId), params.detail);
  return params.detail;
};
