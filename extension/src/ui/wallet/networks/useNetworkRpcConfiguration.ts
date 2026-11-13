import type { ChainRef, NetworkRpcConfiguration } from "@arx/core/networks";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useWallet } from "@/ui/wallet/connection/WalletContext";

const networkRpcConfigurationKey = (chainRef: ChainRef) => ["networkRpcConfiguration", chainRef] as const;

export function refreshNetworkRpcConfigurations(queryClient: QueryClient, chainRefs: readonly ChainRef[]) {
  for (const chainRef of chainRefs) {
    const queryKey = networkRpcConfigurationKey(chainRef);
    void queryClient.cancelQueries({ queryKey, exact: true });
    void queryClient.invalidateQueries({ queryKey, exact: true });
  }
}

export async function updateRpcCache(
  queryClient: QueryClient,
  chainRef: ChainRef,
  configuration: NetworkRpcConfiguration,
) {
  const queryKey = networkRpcConfigurationKey(chainRef);
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData(queryKey, configuration);
  void queryClient.invalidateQueries({ queryKey, exact: true });
}

export function useNetworkRpcConfiguration(chainRef: ChainRef, enabled: boolean) {
  const { client: wallet } = useWallet();
  return useQuery({
    queryKey: networkRpcConfigurationKey(chainRef),
    queryFn: () => wallet.networks.getRpcConfiguration(chainRef),
    enabled,
  });
}
