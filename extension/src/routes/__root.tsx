import { createRootRouteWithContext, Navigate } from "@tanstack/react-router";

export type UiRouterContext = {
  surface: "popup" | "onboarding";
};

export const Route = createRootRouteWithContext<UiRouterContext>()({
  notFoundComponent: () => <Navigate to="/" replace />,
});
