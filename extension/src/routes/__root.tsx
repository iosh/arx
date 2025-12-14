import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet, redirect } from "@tanstack/react-router";
import { createContext, useContext, useState } from "react";
import { Theme, YStack } from "tamagui";
import { SessionGate } from "@/ui/components/SessionGate";
import { useIdleTimer } from "@/ui/hooks/useIdleTimer";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { isOnboardingPath } from "@/ui/lib/onboardingPaths";
import { resolveUiSnapshot } from "@/ui/lib/resolveUiSnapshot";
import { ROUTES } from "@/ui/lib/routes";

// Define context type for type safety
interface ThemeContextType {
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark" | ((prev: "light" | "dark") => "light" | "dark")) => void;
}

// Create React Context for theme
const ThemeContext = createContext<ThemeContextType | null>(null);

// Custom hook to use theme context
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeContext.Provider");
  }
  return context;
}

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
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const { snapshot, isLoading, unlock } = useUiSnapshot();
  const enabled = snapshot?.session.isUnlocked ?? false;
  useIdleTimer(enabled);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <Theme name={theme}>
        <YStack backgroundColor="$background" minHeight="100vh" data-theme={theme}>
          <SessionGate snapshot={snapshot} isLoading={isLoading} unlock={unlock}>
            <Outlet />
          </SessionGate>
        </YStack>
      </Theme>
    </ThemeContext.Provider>
  );
}
