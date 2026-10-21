import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWalletEvents } from "@/ui/wallet/connection/useWalletEvents";
import { useWallet } from "@/ui/wallet/connection/WalletContext";

const networkSelectionKey = ["networkSelection"] as const;

export function useNetworkSelection() {
  const { client: wallet } = useWallet();
  const queryClient = useQueryClient();

  useWalletEvents(wallet, "networkSelectionChanged", () => {
    void queryClient.cancelQueries({ queryKey: networkSelectionKey, exact: true });
    void queryClient.invalidateQueries({ queryKey: networkSelectionKey, exact: true });
  });

  return useQuery({
    queryKey: networkSelectionKey,
    queryFn: () => wallet.networks.getSelection(),
    networkMode: "always",
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });
}
