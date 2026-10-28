import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useWallet } from "@/ui/wallet/connection/WalletContext";

const selectedAccountKey = ["selectedAccount"] as const;

export function refreshSelectedAccount(queryClient: QueryClient) {
  void queryClient.cancelQueries({ queryKey: selectedAccountKey, exact: true });
  void queryClient.invalidateQueries({ queryKey: selectedAccountKey, exact: true });
}

export function useSelectedAccount() {
  const { client: wallet } = useWallet();
  return useQuery({
    queryKey: selectedAccountKey,
    queryFn: () => wallet.accounts.getSelected(),
    networkMode: "always",
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });
}
