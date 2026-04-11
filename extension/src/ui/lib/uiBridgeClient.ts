import type { UiClient } from "@arx/core/ui";
import { createUiClient, uiCommonActions } from "@arx/core/ui";
import { uiActivationActions } from "./uiActivationActions";
import { createUiPortTransport } from "./uiPortTransport";

const transport = createUiPortTransport();

const baseClient: UiClient = createUiClient({
  transport,
  logger: console,
});

const uiExtensionActions = (client: UiClient) => {
  const common = uiCommonActions(client);
  const activation = uiActivationActions(client);

  return {
    ...common,
    entry: activation.entry,
    onboarding: {
      ...common.onboarding,
      ...activation.onboarding,
    },
  };
};

export const uiClient = baseClient.extend(uiExtensionActions);
