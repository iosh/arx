import type { UiMethodHandlerMap, UiPlatformAdapter, UiServerExtension } from "@arx/core/runtime";

export const createUiActivationExtension = (deps: {
  platform: Pick<UiPlatformAdapter, "openOnboardingTab" | "openNotificationPopup">;
}): UiServerExtension => ({
  id: "extension.uiActivation",
  createHandlers: () => {
    const handlers: UiMethodHandlerMap = {
      "ui.onboarding.openTab": async ({ reason }) => await deps.platform.openOnboardingTab(reason),
      "ui.approvals.openPopup": async () => await deps.platform.openNotificationPopup(),
    };

    return handlers;
  },
});
