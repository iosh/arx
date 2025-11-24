import type { UiSnapshot } from "@arx/core/ui";
import { redirect } from "@tanstack/react-router";
import type { RouterContext } from "@/routes/__root";
import { UI_SNAPSHOT_QUERY_KEY } from "@/ui/hooks/useUiSnapshot";
import { uiClient } from "@/ui/lib/uiClient";
import { ROUTES } from "./routes";

const resolveSnapshot = async (context: RouterContext): Promise<UiSnapshot | undefined> => {
  const cached = context.queryClient.getQueryData<UiSnapshot>(UI_SNAPSHOT_QUERY_KEY);
  if (cached) {
    return cached;
  }
  try {
    return await context.queryClient.fetchQuery({
      queryKey: UI_SNAPSHOT_QUERY_KEY,
      queryFn: () => uiClient.getSnapshot(),
      staleTime: Infinity,
    });
  } catch (error) {
    console.warn("[routeGuards] failed to fetch snapshot", error);
    return undefined;
  }
};

/**
 * Route guard: Requires wallet to be unlocked
 *
 * Usage in route definition:
 * ```typescript
 * export const Route = createFileRoute("/accounts")({
 *   beforeLoad: requireUnlocked,
 *   component: AccountsPage,
 * });
 * ```
 */
export const requireUnlocked = async ({ context }: { context: RouterContext }) => {
  const snapshot = await resolveSnapshot(context);
  if (!snapshot) return;
  if (!snapshot.session.isUnlocked) {
    throw redirect({ to: ROUTES.HOME });
  }
};

/**
 * Route guard: Requires vault to be initialized
 */
export const requireInitialized = async ({ context }: { context: RouterContext }) => {
  const snapshot = await resolveSnapshot(context);
  if (!snapshot) return;
  if (!snapshot.vault.initialized) {
    throw redirect({ to: ROUTES.HOME });
  }
};
