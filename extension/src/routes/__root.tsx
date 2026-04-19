import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet, redirect } from "@tanstack/react-router";
import { YStack } from "tamagui";
import { getUiEntryMetadata } from "@/lib/uiEntryMetadata";
import { ApprovalsOrchestrator } from "@/ui/approvals";
import { SessionGate } from "@/ui/components/SessionGate";
import { useIdleTimer } from "@/ui/hooks/useIdleTimer";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getOrFetchUiSnapshot } from "@/ui/lib/getOrFetchUiSnapshot";
import { isOnboardingPath } from "@/ui/lib/onboardingPaths";
import { decideRootBeforeLoad } from "@/ui/lib/rootBeforeLoad";
import { uiClient } from "@/ui/lib/uiBridgeClient";
// Router context type for route guards
export interface RouterContext {
  queryClient: QueryClient;
}

// Root layout component that wraps all routes
export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context, location }) => {
    const entry = getUiEntryMetadata();

    // Fast-path: enforce onboarding surface rules without needing snapshot.
    const preDecision = decideRootBeforeLoad({
      entry,
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

    if (preDecision.type === "redirect") {
      throw redirect({ to: preDecision.to, replace: preDecision.replace });
    }

    if (isOnboardingPath(location.pathname)) {
      // Only the onboarding environment is allowed to reach onboarding routes.
      return;
    }

    const snapshot = await getOrFetchUiSnapshot(context.queryClient);

    const decision = decideRootBeforeLoad({
      entry,
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
      <ApprovalsOrchestrator />
      <SessionGate snapshot={snapshot} isLoading={isLoading} unlock={unlock}>
        <Outlet />
      </SessionGate>
    </YStack>
  );
}
