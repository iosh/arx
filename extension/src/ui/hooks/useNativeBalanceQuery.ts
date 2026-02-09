import type { UiSnapshot } from "@arx/core/ui";
import { useQuery } from "@tanstack/react-query";
import { uiClient } from "@/ui/lib/uiBridgeClient";

const STALE_TIME_MS = 10_000;
const POLL_INTERVAL_MS = 30_000;

export const nativeBalanceQueryKey = (params: { chainRef: string | null; address: string | null }) =>
  ["nativeBalance", params.chainRef, params.address] as const;

export function useNativeBalanceQuery(snapshot: UiSnapshot | null | undefined) {
  const chainRef = snapshot?.chain.chainRef ?? null;
  const address = snapshot?.accounts.active ?? null;

  const enabled = Boolean(
    snapshot?.session.isUnlocked && snapshot?.chain.namespace === "eip155" && chainRef && address,
  );

  const query = useQuery({
    queryKey: nativeBalanceQueryKey({ chainRef, address }),
    enabled,
    queryFn: async () => {
      // enabled implies both are non-null, but keep a clear error if wiring changes.
      if (!chainRef || !address) throw new Error("Missing chainRef/address for native balance query");
      return await uiClient.balances.getNative({ chainRef, address });
    },
    staleTime: STALE_TIME_MS,
    refetchInterval: enabled ? POLL_INTERVAL_MS : false,
    // Always refetch when the popup regains focus (even if data is "fresh").
    refetchOnWindowFocus: "always",
    refetchOnReconnect: false,
  });

  return {
    balanceWei: query.data?.amountWei ?? null,
    isInitialLoading: query.isLoading,
    isRefreshing: query.isFetching && !query.isLoading,
    error: query.error,
    refresh: query.refetch,
  };
}
