import type { WalletClient } from "@arx/wallet-api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWalletEvents } from "./useWalletEvents";

const walletStatusQueryKey = ["walletStatus"] as const;

export function useWalletStatus(wallet: WalletClient) {
  const queryClient = useQueryClient();
  useWalletEvents(wallet, "walletStatusChanged", (event) => {
    // A committed status event takes precedence over an earlier query.
    void queryClient.cancelQueries({ queryKey: walletStatusQueryKey, exact: true });
    queryClient.setQueryData(walletStatusQueryKey, event.status);
  });

  return useQuery({
    queryKey: walletStatusQueryKey,
    queryFn: () => wallet.getStatus(),
    networkMode: "always",
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });
}
