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
