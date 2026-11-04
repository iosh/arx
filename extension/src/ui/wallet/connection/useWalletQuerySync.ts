import type { WalletClient } from "@arx/wallet-api/client";
import { useQueryClient } from "@tanstack/react-query";
import { refreshAccountAddresses } from "../accounts/useAccountAddresses";
import { refreshAccounts } from "../accounts/useAccounts";
import { refreshSelectedAccount } from "../accounts/useSelectedAccount";
import { refreshMnemonicSources } from "../keyring/useMnemonicSources";
import { refreshNetworkRpcConfigurations } from "../networks/useNetworkRpcConfiguration";
import { refreshNetworks } from "../networks/useNetworks";
import { useWalletEvents } from "./useWalletEvents";

/** Registers shared query updates once for the document's wallet connection. */
export function useWalletQuerySync(wallet: WalletClient) {
  const queryClient = useQueryClient();

  useWalletEvents(wallet, ["accountsChanged", "keyringChanged", "networksChanged"], (event) => {
    switch (event.type) {
      case "accountsChanged":
        refreshAccounts(queryClient);
        refreshSelectedAccount(queryClient);
        refreshAccountAddresses(queryClient, event.accountGroupIds);
        break;
      case "keyringChanged":
        refreshMnemonicSources(queryClient);
        break;
      case "networksChanged":
        refreshNetworks(queryClient);
        refreshNetworkRpcConfigurations(queryClient, event.chainRefs);
        break;
    }
  });
}
