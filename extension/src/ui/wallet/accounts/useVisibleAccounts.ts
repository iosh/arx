import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useWallet } from "@/ui/wallet/connection/WalletContext";

const accountsKey = ["accounts"] as const;

export function refreshVisibleAccounts(queryClient: QueryClient) {
  // An event can arrive while the initial read still contains the previous accounts.
  void queryClient.cancelQueries({ queryKey: accountsKey, exact: true });
  void queryClient.invalidateQueries({ queryKey: accountsKey, exact: true });
}

export function useVisibleAccounts() {
  const { client: wallet } = useWallet();
  return useQuery({
    queryKey: accountsKey,
    queryFn: () => wallet.accounts.list(),
    select: (accounts) => accounts.filter((account) => !account.hidden),
    networkMode: "always",
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });
}
