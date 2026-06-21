import type { UiMethodResult } from "@arx/core/ui";
import type { QueryClient } from "@tanstack/react-query";
import { uiClient } from "@/ui/lib/uiBridgeClient";

export const UI_CURRENT_CHAIN_ACCOUNTS_QUERY_KEY = ["uiCurrentChainAccounts"] as const;

export type UiCurrentChainAccountsStatus = {
  session: UiMethodResult<"ui.session.getStatus">;
  chain: UiMethodResult<"ui.networks.getSelectedChain">;
  accounts: UiMethodResult<"ui.accounts.listCurrentChain">;
};

export const fetchUiCurrentChainAccountsStatus = async (): Promise<UiCurrentChainAccountsStatus> => {
  const [session, chain, accounts] = await Promise.all([
    uiClient.session.getStatus(),
    uiClient.networks.getSelectedChain(),
    uiClient.accounts.listCurrentChain(),
  ]);
  return { session, chain, accounts };
};

export const createUiCurrentChainAccountsQueryOptions = () => ({
  queryKey: UI_CURRENT_CHAIN_ACCOUNTS_QUERY_KEY,
  queryFn: fetchUiCurrentChainAccountsStatus,
  staleTime: 30_000,
});

export const refreshUiCurrentChainAccountsIntoCache = async (
  queryClient: QueryClient,
): Promise<UiCurrentChainAccountsStatus> => {
  const status = await fetchUiCurrentChainAccountsStatus();
  queryClient.setQueryData(UI_CURRENT_CHAIN_ACCOUNTS_QUERY_KEY, status);
  return status;
};
