import type { AccountGroup, AccountGroupId, AccountId } from "@arx/core/accounts";
import { type QueryClient, skipToken, useQuery } from "@tanstack/react-query";
import { useWallet } from "@/ui/wallet/connection/WalletContext";

const accountAddressesKey = (accountGroupId: AccountGroupId | undefined) =>
  ["accountAddresses", accountGroupId] as const;

export function refreshAccountAddresses(queryClient: QueryClient, accountGroupIds: readonly AccountGroupId[]) {
  for (const accountGroupId of accountGroupIds) {
    const queryKey = accountAddressesKey(accountGroupId);
    void queryClient.cancelQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey });
  }
}

export function useAccountAddresses(account: AccountGroup | undefined) {
  const { client: wallet } = useWallet();
  return useQuery({
    queryKey: accountAddressesKey(account?.accountGroupId),
    queryFn: account ? () => wallet.accounts.getGroupAddresses({ accountGroupId: account.accountGroupId }) : skipToken,
  });
}

export function useMemberAddresses(accountId: AccountId) {
  const { client: wallet } = useWallet();
  return useQuery({
    queryKey: ["memberAddresses", accountId],
    queryFn: () => wallet.accounts.getMemberAddresses({ accountId }),
  });
}
