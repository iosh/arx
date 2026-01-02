import "../../ui/lib/polyfills";
import { QueryClient } from "@tanstack/react-query";
import { createHashHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { AppProviders } from "../../ui/providers/AppProviders";
import "../popup/style.css";

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </React.StrictMode>,
);
