import { useQueryClient } from "@tanstack/react-query";
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

export const useWalletInvalidations = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    return app.walletEvents.subscribeInvalidation((event) => {
      if (event.topic === "session" || event.topic === "accounts" || event.topic === "networks") {
        void queryClient.invalidateQueries({ queryKey: UI_CURRENT_CHAIN_ACCOUNTS_QUERY_KEY });
      }

      if (event.topic === "session" || event.topic === "setup") {
        void queryClient.invalidateQueries({ queryKey: createUiSetupStatusQueryOptions().queryKey });
      }

      if (event.topic === "networks") {
        void queryClient.invalidateQueries({ queryKey: UI_NETWORKS_QUERY_KEY });
      }

      if (event.topic === "balances") {
        void queryClient.invalidateQueries({ queryKey: UI_NATIVE_BALANCE_QUERY_KEY });
      }

      if (event.topic === "keyrings") {
        void queryClient.invalidateQueries({ queryKey: UI_KEYRINGS_QUERY_KEY });
        void queryClient.invalidateQueries({ queryKey: UI_KEYRING_BACKUP_STATUS_QUERY_KEY });
        void queryClient.invalidateQueries({ queryKey: UI_ACCOUNTS_BY_KEYRING_QUERY_KEY });
      }

      if (event.topic === "approvals") {
        void queryClient.invalidateQueries({ queryKey: UI_APPROVALS_QUERY_KEY });
      }
    });
  }, [queryClient]);
};
