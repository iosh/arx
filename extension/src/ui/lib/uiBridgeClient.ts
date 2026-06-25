import type { UiClient } from "@arx/core/ui";
import { createUiClient } from "@arx/core/ui";
import { createRemoteTrustedWalletClient, createWalletEventApi } from "@arx/core/wallet/bridge";
import { uiActivationActions } from "./uiActivationActions";
import { createBrowserPortChannel, createUiProtocolTransport } from "./uiPortTransport";
import { createWalletBridgePortTransport } from "./walletBridgePortTransport";

const sharedPortChannel = createBrowserPortChannel();

const baseClient: UiClient = createUiClient({
  transport: createUiProtocolTransport(sharedPortChannel),
  logger: console,
});
const walletBridgeTransport = createWalletBridgePortTransport(sharedPortChannel, { logger: console });

const uiExtensionActions = (client: UiClient) => {
  const activation = uiActivationActions(client);

  return {
    entry: activation.entry,
    onboarding: activation.onboarding,
  };
};

export const uiClient = baseClient.extend(uiExtensionActions);
export const app = {
  wallet: createRemoteTrustedWalletClient(walletBridgeTransport),
  walletEvents: createWalletEventApi(walletBridgeTransport),
} as const;
