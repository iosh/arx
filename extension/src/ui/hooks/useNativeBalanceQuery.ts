import type { UiMethodResult, UiSnapshot } from "@arx/core/ui";
import { useQuery } from "@tanstack/react-query";
import { uiClient } from "@/ui/lib/uiBridgeClient";

const STALE_TIME_MS = 10_000;
const POLL_INTERVAL_MS = 30_000;

type NativeBalanceResult = UiMethodResult<"ui.balances.getNative">;

export const nativeBalanceQueryKey = (params: { chainRef: string | null; accountKey: string | null }) =>
  ["nativeBalance", params.chainRef, params.accountKey] as const;

export function useNativeBalanceQuery(snapshot: UiSnapshot | null | undefined) {
  const chainRef = snapshot?.chain.chainRef ?? null;
  const accountKey = snapshot?.accounts.active?.accountKey ?? null;

  const enabled = Boolean(
    snapshot?.session.isUnlocked && snapshot?.chainCapabilities.nativeBalance && chainRef && accountKey,
  );

  const query = useQuery({
    queryKey: nativeBalanceQueryKey({ chainRef, accountKey }),
    enabled,
    queryFn: async () => {
      // enabled implies both are non-null, but keep a clear error if wiring changes.
      if (!chainRef || !accountKey) throw new Error("Missing chainRef/accountKey for native balance query");
      return await uiClient.balances.getNative({ chainRef, accountKey });
    },
    staleTime: STALE_TIME_MS,
    refetchInterval: enabled ? POLL_INTERVAL_MS : false,
    // Always refetch when the popup regains focus (even if data is "fresh").
    refetchOnWindowFocus: "always",
    refetchOnReconnect: false,
  });

  const data = query.data;
  const balance: NativeBalanceResult | null =
    data && data.chainRef === chainRef && data.accountKey === accountKey ? data : null;

  return {
    balance,
    isInitialLoading: query.isLoading,
    isRefreshing: query.isFetching && !query.isLoading,
    error: query.error,
    refresh: query.refetch,
  };
}
