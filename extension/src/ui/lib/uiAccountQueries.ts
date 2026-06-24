import type {
  WalletApiAccountsForCurrentChainResult,
  WalletApiChainSnapshot,
  WalletApiSessionStatusResult,
} from "@arx/core/wallet";
import type { QueryClient } from "@tanstack/react-query";
import { app } from "@/ui/lib/uiBridgeClient";

export const UI_CURRENT_CHAIN_ACCOUNTS_QUERY_KEY = ["uiCurrentChainAccounts"] as const;

export type UiCurrentChainAccountsStatus = {
  session: WalletApiSessionStatusResult;
  chain: WalletApiChainSnapshot;
  accounts: WalletApiAccountsForCurrentChainResult;
};

export const fetchUiCurrentChainAccountsStatus = async (): Promise<UiCurrentChainAccountsStatus> => {
  const [session, chain, accounts] = await Promise.all([
    app.wallet.session.getStatus(),
    app.wallet.networks.getSelectedChain(),
    app.wallet.accounts.listCurrentChain(),
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
