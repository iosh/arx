import "../../ui/lib/polyfills";
import { QueryClient } from "@tanstack/react-query";
import { createHashHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { AppProviders } from "../../ui/providers/AppProviders";
import "../popup/style.css";

import { ErrorState, Screen } from "@/ui/components";
import { getEntryIntent } from "@/ui/lib/entryIntent";
import { routeTree } from "../../routeTree.gen";
import { uiClient } from "../../ui/lib/uiClient";

const queryClient = new QueryClient();
const hashHistory = createHashHistory();

const router = createRouter({
  routeTree,
  history: hashHistory,
  defaultPreload: "intent",
  context: {
    queryClient,
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// TODO: In later stage, notification entry may need different UX when vault is uninitialized.

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
    getEntryIntent();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    renderEntryIntentError(message);
    return;
  }

  try {
    const snapshot = await uiClient.getSnapshot();
    if (!snapshot.vault.initialized) {
      window.close();
      return;
    }
  } catch {
    // Fail-closed for attention surface to avoid showing UI under unknown state.
    window.close();
    return;
  }

  renderApp();
};

void boot();
