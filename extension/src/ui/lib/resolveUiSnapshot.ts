import type { UiSnapshot } from "@arx/core/ui";
import type { QueryClient } from "@tanstack/react-query";
import { UI_SNAPSHOT_QUERY_KEY } from "@/ui/hooks/useUiSnapshot";
import { uiClient } from "@/ui/lib/uiBridgeClient";
export async function resolveUiSnapshot(queryClient: QueryClient): Promise<UiSnapshot | undefined> {
  const cached = queryClient.getQueryData<UiSnapshot>(UI_SNAPSHOT_QUERY_KEY);
  if (cached) return cached;

  try {
    return await queryClient.fetchQuery({
      queryKey: UI_SNAPSHOT_QUERY_KEY,
      queryFn: () => uiClient.waitForSnapshot(),
      staleTime: Infinity,
    });
  } catch (error) {
    console.warn("[resolveUiSnapshot] failed to fetch snapshot", error);
    return undefined;
  }
}
