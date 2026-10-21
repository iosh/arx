import { createHashHistory, createRouter } from "@tanstack/react-router";
import { OnboardingErrorScreen } from "@/ui/components/OnboardingErrorScreen";
import { OnboardingLoadingScreen } from "@/ui/components/OnboardingLoadingScreen";
import { PopupErrorScreen } from "@/ui/components/PopupErrorScreen";
import { PopupLoadingScreen } from "@/ui/components/PopupLoadingScreen";
import type { UiRouterContext } from "./routes/__root";
import { routeTree } from "./routeTree.gen";

export function createUiRouter(surface: UiRouterContext["surface"]) {
  return createRouter({
    routeTree,
    history: createHashHistory(),
    context: { surface },
    defaultPendingComponent: surface === "onboarding" ? OnboardingLoadingScreen : PopupLoadingScreen,
    defaultErrorComponent: surface === "onboarding" ? OnboardingErrorScreen : PopupErrorScreen,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createUiRouter>;
  }
}
