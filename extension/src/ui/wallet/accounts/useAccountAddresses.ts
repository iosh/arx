import type { Account } from "@arx/core/accounts";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWalletEvents } from "@/ui/wallet/connection/useWalletEvents";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useNetworkSelection } from "@/ui/wallet/networks/useNetworkSelection";

export function useAccountAddresses(account: Account) {
  const { client: wallet } = useWallet();
  const queryClient = useQueryClient();
  const networkSelection = useNetworkSelection();
  const chainRef = networkSelection.data?.selectedChainRefByNamespace[account.namespace];
  const accountKey = ["accountAddresses", account.accountId] as const;

  useWalletEvents(wallet, "accountsChanged", (event) => {
    if (!event.accountIds.includes(account.accountId)) return;
    void queryClient.cancelQueries({ queryKey: accountKey });
    void queryClient.invalidateQueries({ queryKey: accountKey });
  });

  const addresses = useQuery({
    queryKey: [...accountKey, chainRef],
    queryFn: chainRef ? () => wallet.accounts.getAddresses({ accountId: account.accountId, chainRef }) : skipToken,
    networkMode: "always",
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });

  return { networkSelection, addresses };
}
