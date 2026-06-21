import type { UiMethodResult } from "@arx/core/ui";
import type { QueryClient } from "@tanstack/react-query";
import { uiClient } from "@/ui/lib/uiBridgeClient";

export const UI_NETWORKS_QUERY_KEY = ["uiNetworks"] as const;

export type UiNetworksStatus = {
  selected: UiMethodResult<"ui.networks.getSelectedChain">;
  networks: UiMethodResult<"ui.networks.list">;
};

export const fetchUiNetworksStatus = async (): Promise<UiNetworksStatus> => {
  const [selected, networks] = await Promise.all([uiClient.networks.getSelectedChain(), uiClient.networks.list()]);
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
