import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createUiNetworksStatusQueryOptions, refreshUiNetworksStatusIntoCache } from "@/ui/lib/uiNetworkQueries";

export function useUiNetworksStatus() {
  return useQuery(createUiNetworksStatusQueryOptions());
}

export function useRefreshUiNetworksStatus() {
  const queryClient = useQueryClient();

  return async () => await refreshUiNetworksStatusIntoCache(queryClient);
}
