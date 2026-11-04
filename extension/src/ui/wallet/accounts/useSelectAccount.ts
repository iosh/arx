import type { AccountGroupId } from "@arx/core/accounts";
import { useWallet } from "../connection/WalletContext";
import { useWalletMutation } from "../useWalletMutation";

export function useSelectAccount() {
  const { client: wallet } = useWallet();
  return useWalletMutation({
    mutationFn: (accountGroupId: AccountGroupId) => wallet.accounts.select({ accountGroupId }),
  });
}
