import type { UiSnapshot } from "@arx/core/ui";
import type { QueryClient } from "@tanstack/react-query";
import { UI_SNAPSHOT_QUERY_KEY } from "@/ui/hooks/useUiSnapshot";
import { uiClient } from "@/ui/lib/uiBridgeClient";

type GetOrFetchUiSnapshotOpts = {
  /**
   * When true, bypasses the query cache and fetches a fresh snapshot via RPC.
   * This is important right after RPCs that intentionally "hold" broadcast events.
   */
  fresh?: boolean;
};

export async function getOrFetchUiSnapshot(
  queryClient: QueryClient,
  opts?: GetOrFetchUiSnapshotOpts,
): Promise<UiSnapshot | undefined> {
  const cached = queryClient.getQueryData<UiSnapshot>(UI_SNAPSHOT_QUERY_KEY);
  if (cached && !opts?.fresh) return cached;

  try {
    const snapshot = opts?.fresh
      ? await uiClient.snapshot.get()
      : await queryClient.fetchQuery({
          queryKey: UI_SNAPSHOT_QUERY_KEY,
          queryFn: () => uiClient.waitForSnapshot(),
          staleTime: Infinity,
        });

    // Keep the React Query cache in sync even when we bypass fetchQuery.
    queryClient.setQueryData(UI_SNAPSHOT_QUERY_KEY, snapshot);
    return snapshot;
  } catch (error) {
    console.warn("[getOrFetchUiSnapshot] failed to fetch snapshot", error);
    return undefined;
  }
}
