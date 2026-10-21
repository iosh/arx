import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWalletEvents } from "@/ui/wallet/connection/useWalletEvents";
import { useWallet } from "@/ui/wallet/connection/WalletContext";

const selectedAccountKey = ["selectedAccount"] as const;

export function useSelectedAccount() {
  const { client: wallet } = useWallet();
  const queryClient = useQueryClient();

  useWalletEvents(wallet, ["accountsChanged", "networkSelectionChanged"], () => {
    void queryClient.cancelQueries({ queryKey: selectedAccountKey, exact: true });
    void queryClient.invalidateQueries({ queryKey: selectedAccountKey, exact: true });
  });

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
