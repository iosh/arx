import type { ChainRef, Network } from "@arx/core/networks";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { useWallet } from "@/ui/wallet/connection/WalletContext";

const networksKey = ["networks"] as const;

export function refreshNetworks(queryClient: QueryClient) {
  void queryClient.cancelQueries({ queryKey: networksKey, exact: true });
  void queryClient.invalidateQueries({ queryKey: networksKey, exact: true });
}

export async function updateNetworkCache(queryClient: QueryClient, network: Network) {
  await queryClient.cancelQueries({ queryKey: networksKey, exact: true });
  queryClient.setQueryData<readonly Network[]>(networksKey, (networks) =>
    networks?.map((current) => (current.chainRef === network.chainRef ? network : current)),
  );
  void queryClient.invalidateQueries({ queryKey: networksKey, exact: true });
}

function useNetworksOptions() {
  const { client: wallet } = useWallet();
  return queryOptions({
    queryKey: networksKey,
    queryFn: () => wallet.networks.list(),
  });
}

export function useNetworks() {
  return useQuery(useNetworksOptions());
}

export function useNetwork(chainRef: ChainRef) {
  return useQuery({
    ...useNetworksOptions(),
    select: (networks) => networks.find((network) => network.chainRef === chainRef) ?? null,
  });
}
