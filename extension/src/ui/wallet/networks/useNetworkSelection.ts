import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useWallet } from "@/ui/wallet/connection/WalletContext";

const networkSelectionKey = ["networkSelection"] as const;

export function refreshNetworkSelection(queryClient: QueryClient) {
  void queryClient.cancelQueries({ queryKey: networkSelectionKey, exact: true });
  void queryClient.invalidateQueries({ queryKey: networkSelectionKey, exact: true });
}

export function useNetworkSelection() {
  const { client: wallet } = useWallet();
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
