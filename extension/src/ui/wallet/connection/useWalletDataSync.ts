import type { WalletClient } from "@arx/wallet-api/client";
import { useQueryClient } from "@tanstack/react-query";
import { refreshAccounts } from "../accounts/useAccounts";
import { useAssetBalances } from "../assets/useAssetBalances";
import { refreshMnemonicSources } from "../keyring/useMnemonicSources";
import { refreshNetworkRpcConfigurations } from "../networks/useNetworkRpcConfiguration";
import { refreshNetworks } from "../networks/useNetworks";
import { useWalletEvents } from "./useWalletEvents";

/** Synchronizes UI data once for the document's wallet connection. */
export function useWalletDataSync(wallet: WalletClient) {
  const queryClient = useQueryClient();
  const invalidateBalances = useAssetBalances((state) => state.invalidate);

  useWalletEvents(wallet, ["accountsChanged", "keyringChanged", "networksChanged"], (event) => {
    switch (event.type) {
      case "accountsChanged":
        refreshAccounts(queryClient);
        break;
      case "keyringChanged":
        refreshMnemonicSources(queryClient);
        break;
      case "networksChanged":
        invalidateBalances({ chainRefs: event.chainRefs });
        refreshNetworks(queryClient);
        refreshNetworkRpcConfigurations(queryClient, event.chainRefs);
        break;
    }
  });
}
