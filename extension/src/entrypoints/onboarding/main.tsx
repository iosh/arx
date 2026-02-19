import "../../ui/lib/polyfills";
import { QueryClient } from "@tanstack/react-query";
import { createHashHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { AppProviders } from "../../ui/providers/AppProviders";
import "../popup/style.css";
import "./style.css";

import { ErrorState, Screen } from "@/ui/components";
import { getEntryIntent } from "@/ui/lib/entryIntent";
import { routeTree } from "../../routeTree.gen";

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

const getRootElement = (): HTMLElement => {
  const el = document.getElementById("root");
  if (!el) throw new Error('Missing "#root" element');
  return el;
};

const renderApp = () => {
  ReactDOM.createRoot(getRootElement()).render(
    <React.StrictMode>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </React.StrictMode>,
  );
};

const renderEntryIntentError = (message: string) => {
  ReactDOM.createRoot(getRootElement()).render(
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

const boot = () => {
  try {
    getEntryIntent();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    renderEntryIntentError(message);
    return;
  }

  renderApp();
};

boot();
