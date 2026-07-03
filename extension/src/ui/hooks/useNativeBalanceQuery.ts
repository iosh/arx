import type { WalletApiNativeBalanceResult } from "@arx/core/wallet";
import { useQuery } from "@tanstack/react-query";
import { app } from "@/ui/lib/app";
import { createUiNativeBalanceQueryKey } from "@/ui/lib/uiBalanceQueries";

const STALE_TIME_MS = 10_000;
const POLL_INTERVAL_MS = 30_000;

type NativeBalanceResult = WalletApiNativeBalanceResult;
export const nativeBalanceQueryKey = createUiNativeBalanceQueryKey;

export function useNativeBalanceQuery(params: { chainRef: string | null; accountId: string | null; enabled: boolean }) {
  const { chainRef, accountId } = params;
  const enabled = Boolean(params.enabled && chainRef && accountId);

  const query = useQuery({
    queryKey: nativeBalanceQueryKey({ chainRef, accountId }),
    enabled,
    queryFn: async () => {
      // enabled implies both are non-null, but keep a clear error if wiring changes.
      if (!chainRef || !accountId) throw new Error("Missing chainRef/accountId for native balance query");
      return await app.wallet.balances.getNative({ chainRef, accountId });
    },
    staleTime: STALE_TIME_MS,
    refetchInterval: enabled ? POLL_INTERVAL_MS : false,
    // Always refetch when the popup regains focus (even if data is "fresh").
    refetchOnWindowFocus: "always",
    refetchOnReconnect: false,
  });

  const data = query.data;
  const balance: NativeBalanceResult | null =
    data && data.chainRef === chainRef && data.accountId === accountId ? data : null;

  return {
    balance,
    isInitialLoading: query.isLoading,
    isRefreshing: query.isFetching && !query.isLoading,
    error: query.error,
    refresh: query.refetch,
  };
}
