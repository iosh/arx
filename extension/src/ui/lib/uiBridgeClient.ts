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
    onboarding: {
      ...common.onboarding,
      ...activation.onboarding,
    },
    approvals: {
      ...common.approvals,
      ...activation.approvals,
    },
  };
};

export const uiClient = baseClient.extend(uiExtensionActions);
