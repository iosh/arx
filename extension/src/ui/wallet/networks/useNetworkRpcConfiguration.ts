import type { ChainRef, NetworkRpcConfiguration } from "@arx/core/networks";
import { type QueryClient, type QueryFilters, skipToken, useQuery } from "@tanstack/react-query";
import { useWallet } from "@/ui/wallet/connection/WalletContext";

const networkRpcConfigurationKey = (chainRef: ChainRef | undefined) => ["networkRpcConfiguration", chainRef] as const;

export function refreshNetworkRpcConfigurations(queryClient: QueryClient, chainRefs: readonly ChainRef[]) {
  const ids = new Set<unknown>(chainRefs);
  const filters: QueryFilters = {
    queryKey: ["networkRpcConfiguration"],
    predicate: ({ queryKey }) => ids.has(queryKey[1]),
  };
  void queryClient.cancelQueries(filters);
  void queryClient.invalidateQueries(filters);
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

export function useNetworkRpcConfiguration(chainRef: ChainRef | undefined) {
  const { client: wallet } = useWallet();
  return useQuery({
    queryKey: networkRpcConfigurationKey(chainRef),
    queryFn: chainRef === undefined ? skipToken : () => wallet.networks.getRpcConfiguration(chainRef),
  });
}
