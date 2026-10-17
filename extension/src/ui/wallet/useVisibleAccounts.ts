import type { Namespace } from "@arx/core/namespaces";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWalletEvents } from "./useWalletEvents";
import { useWallet } from "./WalletContext";

const accountsKey = ["accounts"] as const;

export function useVisibleAccounts(namespace: Namespace) {
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
    select: (accounts) => accounts.filter((account) => account.namespace === namespace && !account.hidden),
    networkMode: "always",
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });
}
