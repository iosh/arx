import { QueryClient } from "@tanstack/react-query";
import { createHashHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { AppProviders } from "../../ui/providers/AppProviders";
import "./style.css";

// Import the generated route tree
import { routeTree } from "../../routeTree.gen";

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </React.StrictMode>,
);
