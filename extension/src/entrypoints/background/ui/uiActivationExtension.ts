import type { UiMethodHandlerMap, UiPlatformAdapter, UiServerExtension } from "@arx/core/runtime";

export const createUiActivationExtension = (deps: {
  entries: Pick<UiPlatformAdapter, "openOnboardingTab" | "openNotificationPopup">;
}): UiServerExtension => ({
  id: "extension.uiActivation",
  createHandlers: () => {
    const handlers: UiMethodHandlerMap = {
      "ui.onboarding.openTab": async ({ reason }) => await deps.entries.openOnboardingTab(reason),
      "ui.approvals.openPopup": async () => await deps.entries.openNotificationPopup(),
    };

    return handlers;
  },
});
