import type { AccountId } from "@arx/core/accounts";
import { useMutation } from "@tanstack/react-query";
import { useWallet } from "../connection/WalletContext";

export function useSelectAccount() {
  const { client: wallet } = useWallet();
  return useMutation({ mutationFn: (accountId: AccountId) => wallet.accounts.select({ accountId }) });
}
