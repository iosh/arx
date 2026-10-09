import { createHashHistory, createRouter } from "@tanstack/react-router";
import { OnboardingError } from "@/ui/pages/error/OnboardingError";
import { PopupError } from "@/ui/pages/error/PopupError";
import { OnboardingLoading } from "@/ui/pages/startup/OnboardingLoading";
import { PopupLoading } from "@/ui/pages/startup/PopupLoading";
import type { UiRouterContext } from "./routes/__root";
import { routeTree } from "./routeTree.gen";

export function createUiRouter(surface: UiRouterContext["surface"]) {
  return createRouter({
    routeTree,
    history: createHashHistory(),
    context: { surface },
    defaultPendingComponent: surface === "onboarding" ? OnboardingLoading : PopupLoading,
    defaultErrorComponent: surface === "onboarding" ? OnboardingError : PopupError,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createUiRouter>;
  }
}
