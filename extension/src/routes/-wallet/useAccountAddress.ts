import type { AccountId } from "@arx/core/accounts";
import type { ChainRef } from "@arx/core/networks";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/ui/wallet/WalletContext";

export function useAccountAddress(accountId: AccountId, chainRef: ChainRef) {
  const { client: wallet } = useWallet();

  return useQuery({
    queryKey: ["accountAddress", accountId, chainRef],
    queryFn: () => wallet.accounts.getAddress({ accountId, chainRef }),
    networkMode: "always",
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });
}
