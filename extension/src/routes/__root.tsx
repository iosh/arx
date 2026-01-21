import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet, redirect } from "@tanstack/react-router";
import { YStack } from "tamagui";
import { SessionGate } from "@/ui/components/SessionGate";
import { useIdleTimer } from "@/ui/hooks/useIdleTimer";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getEntryIntent } from "@/ui/lib/entryIntent";
import { isOnboardingPath } from "@/ui/lib/onboardingPaths";
import { resolveUiSnapshot } from "@/ui/lib/resolveUiSnapshot";
import { decideRootBeforeLoad } from "@/ui/lib/rootBeforeLoad";
import { uiClient } from "@/ui/lib/uiBridgeClient";
// Router context type for route guards
export interface RouterContext {
  queryClient: QueryClient;
}

// Root layout component that wraps all routes
export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context, location }) => {
    const entryIntent = getEntryIntent();

    // Fast-path: enforce onboarding surface rules without needing snapshot.
    const preDecision = decideRootBeforeLoad({
      entryIntent,
      pathname: location.pathname,
      snapshot: null,
    });

    if (preDecision.type === "openOnboardingAndClose") {
      void uiClient.onboarding.openTab({ reason: preDecision.reason });
      window.close();
      return;
    }

    if (preDecision.type === "close") {
      window.close();
      return;
    }

    if (isOnboardingPath(location.pathname)) {
      // Only onboarding_tab is allowed to reach here.
      return;
    }

    const snapshot = await resolveUiSnapshot(context.queryClient);

    const decision = decideRootBeforeLoad({
      entryIntent,
      pathname: location.pathname,
      snapshot: snapshot ?? null,
    });

    if (decision.type === "openOnboardingAndClose") {
      void uiClient.onboarding.openTab({ reason: decision.reason });
      window.close();
      return;
    }

    if (decision.type === "close") {
      window.close();
      return;
    }

    if (decision.type === "redirect") {
      throw redirect({ to: decision.to, replace: decision.replace });
    }

    // allow
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
