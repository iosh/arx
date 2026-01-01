import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet, redirect } from "@tanstack/react-router";
import { YStack } from "tamagui";
import { SessionGate } from "@/ui/components/SessionGate";
import { useIdleTimer } from "@/ui/hooks/useIdleTimer";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { isOnboardingPath } from "@/ui/lib/onboardingPaths";
import { resolveUiSnapshot } from "@/ui/lib/resolveUiSnapshot";
import { ROUTES } from "@/ui/lib/routes";

// Router context type for route guards
export interface RouterContext {
  queryClient: QueryClient;
}

// Root layout component that wraps all routes
export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context, location }) => {
    if (isOnboardingPath(location.pathname)) return;

    try {
      const snapshot = await resolveUiSnapshot(context.queryClient);
      if (!snapshot) return;
      if (snapshot.vault.initialized) return;

      throw redirect({ to: ROUTES.WELCOME, replace: true });
    } catch (error) {
      // Re-throw redirect errors, only catch fetch errors
      if (error && typeof error === "object" && "isRedirect" in error) {
        throw error;
      }
      console.warn("[__root] failed to enforce onboarding redirect", error);
    }
  },
  component: RootLayout,
});

function RootLayout() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <RootInner />
    </QueryClientProvider>
  );
}

function RootInner() {
  const { snapshot, isLoading, unlock } = useUiSnapshot();
  const enabled = snapshot?.session.isUnlocked ?? false;
  useIdleTimer(enabled);

  return (
    <YStack backgroundColor="$bg" flex={1} height="100%" minHeight={0}>
      <SessionGate snapshot={snapshot} isLoading={isLoading} unlock={unlock}>
        <Outlet />
      </SessionGate>
    </YStack>
  );
}
