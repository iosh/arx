import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWalletEvents } from "@/ui/wallet/useWalletEvents";
import { useWallet } from "@/ui/wallet/WalletContext";

const homeAccountKey = ["homeAccount"] as const;

export function useHomeAccount() {
  const { client: wallet } = useWallet();
  const queryClient = useQueryClient();

  useWalletEvents(wallet, ["keyringChanged", "accountsChanged", "networkSelectionChanged"], () => {
    // Invalidation alone can reuse an in-flight initial read.
    void queryClient.cancelQueries({ queryKey: homeAccountKey, exact: true });
    void queryClient.invalidateQueries({ queryKey: homeAccountKey, exact: true });
  });

  return useQuery({
    queryKey: homeAccountKey,
    queryFn: async () => {
      const account = await wallet.accounts.getSelected();
      if (account.origin.type !== "hd") return { account, backupPending: false };

      const keyring = await wallet.hdKeyrings.get(account.origin.hdKeyringId);
      const source = await wallet.keySources.get(keyring.keySourceId);
      return { account, backupPending: source.type === "bip39" && source.backupStatus === "pending" };
    },
    networkMode: "always",
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });
}
