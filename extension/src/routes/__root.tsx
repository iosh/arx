import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider, useMutation, useQueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet, redirect } from "@tanstack/react-router";
import { useCallback } from "react";
import { YStack } from "tamagui";
import { getUiEntryMetadata } from "@/lib/uiEntryMetadata";
import { ApprovalsOrchestrator } from "@/ui/approvals";
import { SessionGate } from "@/ui/components/SessionGate";
import { useIdleTimer } from "@/ui/hooks/useIdleTimer";
import { useUiSessionEvents } from "@/ui/hooks/useUiSessionEvents";
import { useUiSetupStatus } from "@/ui/hooks/useUiSetupStatus";
import { isOnboardingPath } from "@/ui/lib/onboardingPaths";
import { decideRootBeforeLoad } from "@/ui/lib/rootBeforeLoad";
import { uiClient } from "@/ui/lib/uiBridgeClient";
import { createUiSetupStatusQueryOptions, getOrFetchUiSetupStatus } from "@/ui/lib/uiSetupStatusQuery";
// Router context type for route guards
export interface RouterContext {
  queryClient: QueryClient;
}

// Root layout component that wraps all routes
export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context, location }) => {
    const entry = getUiEntryMetadata();

    // Fast-path: enforce onboarding surface rules before loading setup status.
    const preDecision = decideRootBeforeLoad({
      entry,
      pathname: location.pathname,
      setupStatus: null,
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

    const setupStatus = await getOrFetchUiSetupStatus(context.queryClient);

    const decision = decideRootBeforeLoad({
      entry,
      pathname: location.pathname,
      setupStatus: setupStatus ?? null,
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
  const queryClient = useQueryClient();
  const setupStatusQuery = useUiSetupStatus();
  const unlockMutation = useMutation({
    mutationFn: (password: string) => uiClient.session.unlock({ password }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: createUiSetupStatusQueryOptions().queryKey });
    },
  });
  const enabled = setupStatusQuery.data?.session.isUnlocked ?? false;
  useIdleTimer(enabled);

  const refreshSetupStatus = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: createUiSetupStatusQueryOptions().queryKey });
  }, [queryClient]);
  useUiSessionEvents(refreshSetupStatus);

  return (
    <YStack backgroundColor="$bg" flex={1} height="100%" minHeight={0}>
      <ApprovalsOrchestrator />
      <SessionGate
        sessionStatus={setupStatusQuery.data?.session}
        isLoading={setupStatusQuery.isLoading}
        unlock={unlockMutation.mutateAsync}
      >
        <Outlet />
      </SessionGate>
    </YStack>
  );
}
