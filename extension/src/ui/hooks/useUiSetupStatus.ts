import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createUiSetupStatusQueryOptions, refreshUiSetupStatusIntoCache } from "@/ui/lib/uiSetupStatusQuery";

export function useUiSetupStatus() {
  return useQuery(createUiSetupStatusQueryOptions());
}

export function useRefreshUiSetupStatus() {
  const queryClient = useQueryClient();

  return async () => await refreshUiSetupStatusIntoCache(queryClient);
}
