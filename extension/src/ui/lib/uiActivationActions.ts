import type { UiClient, UiMethodParams, UiMethodResult } from "@arx/core/ui";

export const uiActivationActions = (client: UiClient) => {
  const getLaunchContext = (
    params: UiMethodParams<"ui.entry.getLaunchContext">,
  ): Promise<UiMethodResult<"ui.entry.getLaunchContext">> => client.call("ui.entry.getLaunchContext", params);

  const openTab = (params: UiMethodParams<"ui.onboarding.openTab">): Promise<UiMethodResult<"ui.onboarding.openTab">> =>
    client.call("ui.onboarding.openTab", params);

  return {
    entry: {
      getLaunchContext,
    },
    onboarding: {
      openTab,
    },
  };
};
