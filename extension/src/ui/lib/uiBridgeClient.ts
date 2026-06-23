import type { UiClient } from "@arx/core/ui";
import { createUiClient, uiCommonActions } from "@arx/core/ui";
import { createRemoteTrustedWalletClient } from "@arx/core/wallet/bridge";
import { uiActivationActions } from "./uiActivationActions";
import { createBrowserPortChannel, createUiProtocolTransport } from "./uiPortTransport";
import { createWalletBridgePortTransport } from "./walletBridgePortTransport";

const sharedPortChannel = createBrowserPortChannel();

const baseClient: UiClient = createUiClient({
  transport: createUiProtocolTransport(sharedPortChannel),
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
export const wallet = createRemoteTrustedWalletClient(
  createWalletBridgePortTransport(sharedPortChannel, { logger: console }),
);
