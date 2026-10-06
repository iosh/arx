import type { WalletClient } from "@arx/wallet-api/client";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useWalletClient } from "./WalletClientContext";

export const walletStatusQueryKey = ["walletStatus"] as const;

const walletStatusQueryOptions = (wallet: WalletClient) =>
  queryOptions({
    queryKey: walletStatusQueryKey,
    queryFn: () => wallet.getStatus(),
    networkMode: "always",
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });

export function useWalletStatus() {
  const wallet = useWalletClient();
  return useQuery(walletStatusQueryOptions(wallet));
}

export function useSuspenseWalletStatus() {
  const wallet = useWalletClient();
  return useSuspenseQuery(walletStatusQueryOptions(wallet)).data;
}
