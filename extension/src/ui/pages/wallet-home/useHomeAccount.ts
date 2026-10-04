import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useWalletClient } from "@/ui/wallet/WalletClientContext";

const homeAccountKey = ["homeAccount"] as const;

export function useHomeAccount() {
  const wallet = useWalletClient();
  const queryClient = useQueryClient();

  useEffect(
    () =>
      wallet.subscribe((event) => {
        if (
          event.type !== "keyringChanged" &&
          event.type !== "accountsChanged" &&
          event.type !== "networkSelectionChanged"
        ) {
          return;
        }
        // Invalidation alone can reuse an in-flight initial read.
        void queryClient.cancelQueries({ queryKey: homeAccountKey, exact: true });
        void queryClient.invalidateQueries({ queryKey: homeAccountKey, exact: true });
      }),
    [wallet, queryClient],
  );

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
