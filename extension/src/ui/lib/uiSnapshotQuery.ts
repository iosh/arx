import type { UiSnapshot } from "@arx/core/ui";
import type { QueryClient } from "@tanstack/react-query";
import { uiClient } from "@/ui/lib/uiBridgeClient";

export const UI_SNAPSHOT_QUERY_KEY = ["uiSnapshot"] as const;

const waitForUiSnapshot = async (): Promise<UiSnapshot> => {
  return await uiClient.waitForSnapshot();
};

export const createUiSnapshotQueryOptions = () => ({
  queryKey: UI_SNAPSHOT_QUERY_KEY,
  queryFn: waitForUiSnapshot,
  staleTime: Infinity,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
});

export const readCachedUiSnapshot = (queryClient: QueryClient): UiSnapshot | undefined => {
  return queryClient.getQueryData<UiSnapshot>(UI_SNAPSHOT_QUERY_KEY);
};

export const writeCachedUiSnapshot = (queryClient: QueryClient, snapshot: UiSnapshot): void => {
  queryClient.setQueryData(UI_SNAPSHOT_QUERY_KEY, snapshot);
};

export const loadUiSnapshotIntoCache = async (queryClient: QueryClient): Promise<UiSnapshot> => {
  const snapshot = await queryClient.fetchQuery({
    queryKey: UI_SNAPSHOT_QUERY_KEY,
    queryFn: waitForUiSnapshot,
    staleTime: Infinity,
  });

  writeCachedUiSnapshot(queryClient, snapshot);
  return snapshot;
};

export const refreshUiSnapshotIntoCache = async (queryClient: QueryClient): Promise<UiSnapshot> => {
  const snapshot = await uiClient.snapshot.get();
  writeCachedUiSnapshot(queryClient, snapshot);
  return snapshot;
};

/**
 * Waits for a snapshot that satisfies the predicate and mirrors it into the query cache.
 * If the snapshot event stream lags behind a mutation reply, falls back to one fresh snapshot query.
 */
export const waitForUiSnapshotMatch = async (
  queryClient: QueryClient,
  predicate: (snapshot: UiSnapshot) => boolean,
  opts?: { timeoutMs?: number },
): Promise<UiSnapshot | undefined> => {
  try {
    const snapshot = await uiClient.waitForSnapshot({
      timeoutMs: opts?.timeoutMs,
      predicate,
    });
    writeCachedUiSnapshot(queryClient, snapshot);
    return snapshot;
  } catch {
    try {
      const snapshot = await refreshUiSnapshotIntoCache(queryClient);
      if (!predicate(snapshot)) return undefined;
      return snapshot;
    } catch {
      return undefined;
    }
  }
};
