import type { WalletApiChainSnapshot, WalletApiNetworksResult } from "@arx/core/wallet";
import type { QueryClient } from "@tanstack/react-query";
import { app } from "@/ui/lib/uiBridgeClient";

export const UI_NETWORKS_QUERY_KEY = ["uiNetworks"] as const;

export type UiNetworksStatus = {
  selected: WalletApiChainSnapshot;
  networks: WalletApiNetworksResult;
};

export const fetchUiNetworksStatus = async (): Promise<UiNetworksStatus> => {
  const [selected, networks] = await Promise.all([app.wallet.networks.getSelectedChain(), app.wallet.networks.list()]);
  return { selected, networks };
};

export const createUiNetworksStatusQueryOptions = () => ({
  queryKey: UI_NETWORKS_QUERY_KEY,
  queryFn: fetchUiNetworksStatus,
  staleTime: 30_000,
});

export const refreshUiNetworksStatusIntoCache = async (queryClient: QueryClient): Promise<UiNetworksStatus> => {
  const status = await fetchUiNetworksStatus();
  queryClient.setQueryData(UI_NETWORKS_QUERY_KEY, status);
  return status;
};
