import type { UiMethodHandlerMap, UiPlatformAdapter, UiServerExtension } from "@arx/core/runtime";
import type { UiMethodParams, UiMethodResult } from "@arx/core/ui";

export type UiActivationEntries = Pick<UiPlatformAdapter, "openOnboardingTab"> & {
  getEntryLaunchContext: (
    params: UiMethodParams<"ui.entry.getLaunchContext">,
  ) => UiMethodResult<"ui.entry.getLaunchContext"> | Promise<UiMethodResult<"ui.entry.getLaunchContext">>;
  getEntryBootstrap: (
    params: UiMethodParams<"ui.entry.getBootstrap">,
  ) => UiMethodResult<"ui.entry.getBootstrap"> | Promise<UiMethodResult<"ui.entry.getBootstrap">>;
};

export const createUiActivationExtension = (deps: { entries: UiActivationEntries }): UiServerExtension => ({
  id: "extension.uiActivation",
  createHandlers: () => {
    const handlers: UiMethodHandlerMap = {
      "ui.entry.getLaunchContext": async (params: UiMethodParams<"ui.entry.getLaunchContext">) =>
        await deps.entries.getEntryLaunchContext(params),
      "ui.entry.getBootstrap": async (params: UiMethodParams<"ui.entry.getBootstrap">) =>
        await deps.entries.getEntryBootstrap(params),
      "ui.onboarding.openTab": async ({ reason }: UiMethodParams<"ui.onboarding.openTab">) =>
        await deps.entries.openOnboardingTab(reason),
    };

    return handlers;
  },
});
