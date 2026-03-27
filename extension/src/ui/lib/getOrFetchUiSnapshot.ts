import type { UiSnapshot } from "@arx/core/ui";
import type { QueryClient } from "@tanstack/react-query";
import { loadUiSnapshotIntoCache, readCachedUiSnapshot, refreshUiSnapshotIntoCache } from "@/ui/lib/uiSnapshotQuery";

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
  const cached = readCachedUiSnapshot(queryClient);
  if (cached && !opts?.fresh) return cached;

  try {
    return opts?.fresh ? await refreshUiSnapshotIntoCache(queryClient) : await loadUiSnapshotIntoCache(queryClient);
  } catch (error) {
    console.warn("[getOrFetchUiSnapshot] failed to fetch snapshot", error);
    return undefined;
  }
}
