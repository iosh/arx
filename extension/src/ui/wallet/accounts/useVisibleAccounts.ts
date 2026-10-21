import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWalletEvents } from "@/ui/wallet/connection/useWalletEvents";
import { useWallet } from "@/ui/wallet/connection/WalletContext";

const accountsKey = ["accounts"] as const;

export function useVisibleAccounts() {
  const { client: wallet } = useWallet();
  const queryClient = useQueryClient();

  useWalletEvents(wallet, "accountsChanged", () => {
    // An event can arrive while the initial read still contains the previous selection.
    void queryClient.cancelQueries({ queryKey: accountsKey, exact: true });
    void queryClient.invalidateQueries({ queryKey: accountsKey, exact: true });
  });

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
