import type { UiMethodHandlerMap, UiPlatformAdapter, UiServerExtension } from "@arx/core/runtime";
import type { UiMethodParams, UiMethodResult } from "@arx/core/ui";

export type UiActivationEntries = Pick<UiPlatformAdapter, "openOnboardingTab" | "openNotificationPopup"> & {
  getEntryLaunchContext: (
    params: UiMethodParams<"ui.entry.getLaunchContext">,
  ) => UiMethodResult<"ui.entry.getLaunchContext"> | Promise<UiMethodResult<"ui.entry.getLaunchContext">>;
};

export const createUiActivationExtension = (deps: { entries: UiActivationEntries }): UiServerExtension => ({
  id: "extension.uiActivation",
  createHandlers: () => {
    const handlers: UiMethodHandlerMap = {
      "ui.entry.getLaunchContext": async (params: UiMethodParams<"ui.entry.getLaunchContext">) =>
        await deps.entries.getEntryLaunchContext(params),
      "ui.onboarding.openTab": async ({ reason }: UiMethodParams<"ui.onboarding.openTab">) =>
        await deps.entries.openOnboardingTab(reason),
      "ui.approvals.openPopup": async () => await deps.entries.openNotificationPopup(),
    };

    return handlers;
  },
});
