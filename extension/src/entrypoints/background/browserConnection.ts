import type { DuplexChannel } from "@arx/message-channel";
import type { DappTransportHost } from "@arx/provider/host";
import type { WalletHost } from "@arx/wallet-api/host";
import type { Runtime } from "webextension-polyfill";
import { createPortChannel, PORT_HOST_READY_MESSAGE } from "@/transport/browserPort";
import { DAPP_PROVIDER_PORT_NAME, WALLET_UI_PORT_NAME } from "@/transport/portNames";

type BackgroundHosts = Readonly<{
  wallet: WalletHost;
  dapp: DappTransportHost;
}>;

type BrowserClient =
  | Readonly<{ kind: "wallet-ui" }>
  | Readonly<{
      kind: "dapp";
      origin: string;
    }>;

export type HandleBrowserConnectionOptions = Readonly<{
  connection: Runtime.Port;
  hosts: Promise<BackgroundHosts>;
  extensionUrl: string;
  runtimeId: string;
}>;

const parseUrl = (value: string | undefined): URL | null => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const identifyBrowserClient = (
  connection: Runtime.Port,
  input: Readonly<{ extensionUrl: string; runtimeId: string }>,
): BrowserClient | null => {
  if (connection.sender?.id !== input.runtimeId) {
    return null;
  }

  const senderUrl = parseUrl(connection.sender.url);
  if (!senderUrl) {
    return null;
  }

  if (connection.name === WALLET_UI_PORT_NAME) {
    const extensionUrl = parseUrl(input.extensionUrl);
    if (!extensionUrl || senderUrl.protocol !== extensionUrl.protocol || senderUrl.host !== extensionUrl.host) {
      return null;
    }

    return { kind: "wallet-ui" };
  }

  if (connection.name === DAPP_PROVIDER_PORT_NAME) {
    if (senderUrl.protocol !== "http:" && senderUrl.protocol !== "https:") {
      return null;
    }

    return { kind: "dapp", origin: senderUrl.origin };
  }

  return null;
};

const closeBrowserConnection = (connection: Runtime.Port): void => {
  try {
    connection.disconnect();
  } catch {
    // The browser connection is already closed.
  }
};

const attachBrowserClient = (client: BrowserClient, hosts: BackgroundHosts, channel: DuplexChannel): void => {
  if (client.kind === "wallet-ui") {
    hosts.wallet.attach(channel);
    return;
  }

  hosts.dapp.attach({ channel, origin: client.origin });
};

export const handleBrowserConnection = async ({
  connection,
  hosts,
  extensionUrl,
  runtimeId,
}: HandleBrowserConnectionOptions): Promise<void> => {
  const client = identifyBrowserClient(connection, { extensionUrl, runtimeId });
  if (!client) {
    closeBrowserConnection(connection);
    return;
  }

  let waitingForHosts = true;
  const stopWaiting = () => {
    waitingForHosts = false;
    connection.onDisconnect.removeListener(stopWaiting);
  };
  const closeWhileWaiting = () => {
    if (!waitingForHosts) {
      return;
    }

    stopWaiting();
    closeBrowserConnection(connection);
  };

  connection.onDisconnect.addListener(stopWaiting);

  let availableHosts: BackgroundHosts;
  try {
    availableHosts = await hosts;
  } catch {
    closeWhileWaiting();
    return;
  }

  if (!waitingForHosts) {
    return;
  }

  stopWaiting();
  try {
    const channel = createPortChannel(connection);
    attachBrowserClient(client, availableHosts, channel);
  } catch (error) {
    closeBrowserConnection(connection);
    throw error;
  }

  try {
    connection.postMessage(PORT_HOST_READY_MESSAGE);
  } catch {
    closeBrowserConnection(connection);
  }
};
