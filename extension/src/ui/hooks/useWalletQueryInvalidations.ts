import type { WalletEvent } from "@arx/core/wallet";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { UI_CURRENT_CHAIN_ACCOUNTS_QUERY_KEY } from "@/ui/lib/uiAccountQueries";
import { UI_APPROVALS_QUERY_KEY } from "@/ui/lib/uiApprovalQueries";
import { UI_NATIVE_BALANCE_QUERY_KEY } from "@/ui/lib/uiBalanceQueries";
import {
  UI_ACCOUNTS_BY_KEYRING_QUERY_KEY,
  UI_KEYRING_BACKUP_STATUS_QUERY_KEY,
  UI_KEYRINGS_QUERY_KEY,
} from "@/ui/lib/uiKeyringQueries";
import { UI_NETWORKS_QUERY_KEY } from "@/ui/lib/uiNetworkQueries";
import { createUiSetupStatusQueryOptions } from "@/ui/lib/uiSetupStatusQuery";
import { app } from "../lib/app";

const invalidateIdentityQueries = (queryClient: QueryClient, event: WalletEvent) => {
  void queryClient.invalidateQueries({ queryKey: UI_CURRENT_CHAIN_ACCOUNTS_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: createUiSetupStatusQueryOptions().queryKey });
  void queryClient.invalidateQueries({ queryKey: UI_NATIVE_BALANCE_QUERY_KEY });

  if (event.topic !== "identity" || event.change === "selection") {
    return;
  }

  void queryClient.invalidateQueries({ queryKey: UI_KEYRINGS_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: UI_KEYRING_BACKUP_STATUS_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: UI_ACCOUNTS_BY_KEYRING_QUERY_KEY });
};

export const useWalletQueryInvalidations = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    return app.walletEvents.subscribe((event) => {
      switch (event.topic) {
        case "session":
          void queryClient.invalidateQueries({ queryKey: UI_CURRENT_CHAIN_ACCOUNTS_QUERY_KEY });
          void queryClient.invalidateQueries({ queryKey: createUiSetupStatusQueryOptions().queryKey });
          break;
        case "identity":
          invalidateIdentityQueries(queryClient, event);
          break;
        case "network":
          void queryClient.invalidateQueries({ queryKey: UI_CURRENT_CHAIN_ACCOUNTS_QUERY_KEY });
          void queryClient.invalidateQueries({ queryKey: UI_NETWORKS_QUERY_KEY });
          void queryClient.invalidateQueries({ queryKey: UI_NATIVE_BALANCE_QUERY_KEY });
          break;
        case "approvals":
          void queryClient.invalidateQueries({ queryKey: UI_APPROVALS_QUERY_KEY });
          break;
        case "attention":
        case "transactions":
          break;
      }
    });
  }, [queryClient]);
};
