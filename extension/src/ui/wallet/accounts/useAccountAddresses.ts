import type { Account, AccountId } from "@arx/core/accounts";
import { type QueryClient, skipToken, useQuery } from "@tanstack/react-query";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useNetworkSelection } from "@/ui/wallet/networks/useNetworkSelection";

const accountAddressesKey = (accountId: AccountId) => ["accountAddresses", accountId] as const;

export function refreshAccountAddresses(queryClient: QueryClient, accountIds: readonly AccountId[]) {
  for (const accountId of accountIds) {
    const queryKey = accountAddressesKey(accountId);
    void queryClient.cancelQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey });
  }
}

export function useAccountAddresses(account: Account) {
  const { client: wallet } = useWallet();
  const networkSelection = useNetworkSelection();
  const chainRef = networkSelection.data?.selectedChainRefByNamespace[account.namespace];

  const addresses = useQuery({
    queryKey: [...accountAddressesKey(account.accountId), chainRef],
    queryFn: chainRef ? () => wallet.accounts.getAddresses({ accountId: account.accountId, chainRef }) : skipToken,
    networkMode: "always",
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });

  return { networkSelection, addresses };
}
