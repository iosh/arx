import { createHashHistory, createRouter } from "@tanstack/react-router";
import { OnboardingError } from "@/ui/components/OnboardingError";
import { OnboardingLoading } from "@/ui/components/OnboardingLoading";
import { PopupError } from "@/ui/components/PopupError";
import { PopupLoading } from "@/ui/components/PopupLoading";
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
