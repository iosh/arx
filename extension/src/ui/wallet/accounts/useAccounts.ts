import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { useWallet } from "@/ui/wallet/connection/WalletContext";

const accountsKey = ["accounts"] as const;

export function refreshAccounts(queryClient: QueryClient) {
  // An event can arrive while the initial read still contains the previous accounts.
  void queryClient.cancelQueries({ queryKey: accountsKey, exact: true });
  void queryClient.invalidateQueries({ queryKey: accountsKey, exact: true });
}

function useAccountsOptions() {
  const { client: wallet } = useWallet();
  return queryOptions({
    queryKey: accountsKey,
    queryFn: () => wallet.accounts.list(),
    networkMode: "always",
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });
}

export function useAccounts() {
  return useQuery(useAccountsOptions());
}

export function useVisibleAccounts() {
  return useQuery({
    ...useAccountsOptions(),
    select: (accounts) => accounts.filter((account) => !account.hidden),
  });
}
