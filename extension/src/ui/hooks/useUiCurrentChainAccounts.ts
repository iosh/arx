import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createUiCurrentChainAccountsQueryOptions,
  refreshUiCurrentChainAccountsIntoCache,
} from "@/ui/lib/uiAccountQueries";

export function useUiCurrentChainAccounts() {
  return useQuery(createUiCurrentChainAccountsQueryOptions());
}

export function useRefreshUiCurrentChainAccounts() {
  const queryClient = useQueryClient();

  return async () => await refreshUiCurrentChainAccountsIntoCache(queryClient);
}
