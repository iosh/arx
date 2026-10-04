import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useWalletClient } from "./WalletClientContext";

const walletStatusKey = ["walletStatus"] as const;

export function useWalletStatus() {
  const wallet = useWalletClient();
  const queryClient = useQueryClient();

  useEffect(
    () =>
      wallet.subscribe((event) => {
        if (event.type !== "walletStatusChanged") return;
        // A committed status event takes precedence over an earlier query.
        void queryClient.cancelQueries({ queryKey: walletStatusKey, exact: true });
        queryClient.setQueryData(walletStatusKey, event.status);
      }),
    [wallet, queryClient],
  );

  return useQuery({
    queryKey: walletStatusKey,
    queryFn: () => wallet.getStatus(),
    networkMode: "always",
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });
}
