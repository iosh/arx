import "@/ui/lib/polyfills";
import { QueryClient } from "@tanstack/react-query";
import { createHashHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { AppProviders } from "@/ui/providers/AppProviders";
import "./style.css";
// Import the generated route tree
import { routeTree } from "@/routeTree.gen";
import { ErrorState, Screen } from "@/ui/components";
import { getEntryIntent } from "@/ui/lib/entryIntent";
import { needsOnboarding } from "@/ui/lib/rootBeforeLoad";
import { uiClient } from "@/ui/lib/uiBridgeClient";

// Create QueryClient instance (shared across entire app)
const queryClient = new QueryClient();

// Create hash history for browser extension compatibility
const hashHistory = createHashHistory();

// Create router instance with hash history and context
const router = createRouter({
  routeTree,
  history: hashHistory,
  defaultPreload: "intent", // Preload routes on hover/focus for better UX
  context: {
    queryClient, // Pass queryClient to route guards
  },
});

// Register router for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const renderApp = () => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </React.StrictMode>,
  );
};

const renderEntryIntentError = (message: string) => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppProviders>
        <Screen title="Startup error" scroll={false}>
          <ErrorState
            title="Invalid entry intent"
            message={message}
            primaryAction={{ label: "Reload", onPress: () => window.location.reload() }}
            secondaryAction={{ label: "Close", onPress: () => window.close(), variant: "secondary" }}
          />
        </Screen>
      </AppProviders>
    </React.StrictMode>,
  );
};

const boot = async () => {
  try {
    // Guard against running under wrong entrypoint semantics.
    getEntryIntent();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    renderEntryIntentError(message);
    return;
  }

  try {
    const snapshot = await uiClient.snapshot.get();
    const needsOnboardingNow = needsOnboarding(snapshot);

    if (needsOnboardingNow) {
      void uiClient.onboarding.openTab("manual_open");
      window.close();
      return;
    }
  } catch (error) {
    console.error("[popup] preflight snapshot failed; rendering popup", error);
  }

  renderApp();
};

void boot();
