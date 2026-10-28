import type { WalletClient } from "@arx/wallet-api/client";
import { useQueryClient } from "@tanstack/react-query";
import { refreshAccountAddresses } from "../accounts/useAccountAddresses";
import { refreshSelectedAccount } from "../accounts/useSelectedAccount";
import { refreshVisibleAccounts } from "../accounts/useVisibleAccounts";
import { refreshMnemonicSources } from "../keyring/useMnemonicSources";
import { refreshNetworkSelection } from "../networks/useNetworkSelection";
import { useWalletEvents } from "./useWalletEvents";

/** Registers shared query updates once for the document's wallet connection. */
export function useWalletQuerySync(wallet: WalletClient) {
  const queryClient = useQueryClient();

  useWalletEvents(wallet, ["accountsChanged", "networkSelectionChanged", "keyringChanged"], (event) => {
    switch (event.type) {
      case "accountsChanged":
        refreshVisibleAccounts(queryClient);
        refreshSelectedAccount(queryClient);
        refreshAccountAddresses(queryClient, event.accountIds);
        break;
      case "networkSelectionChanged":
        refreshNetworkSelection(queryClient);
        refreshSelectedAccount(queryClient);
        break;
      case "keyringChanged":
        refreshMnemonicSources(queryClient);
        break;
    }
  });
}
