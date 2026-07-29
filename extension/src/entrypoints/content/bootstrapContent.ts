import {
  type PageToWalletMessage,
  parsePageToWalletMessage,
  parseWalletToPageMessage,
  type WalletToPageMessage,
} from "@arx/provider/protocol";
import browser, { type Runtime } from "webextension-polyfill";
import { createContentToPageMessage, readPageToContentMessage } from "@/channels/inpageProviderChannel";
import { createPortChannel } from "@/channels/portChannel";
import { DAPP_PROVIDER_PORT_NAME } from "@/channels/portNames";

type ActiveProviderPort = {
  port: Runtime.Port;
  channel: ReturnType<typeof createPortChannel>;
  unsubscribeMessage(): void;
  unsubscribeDisconnect(): void;
};

export type BootstrapContentOptions = Readonly<{
  targetWindow?: Window;
  connectProviderPort?: () => Runtime.Port;
}>;

const DISCONNECTED_MESSAGE = {
  type: "transport_disconnected",
  error: {
    kind: "disconnected",
    message: "The provider is disconnected.",
  },
} as const satisfies WalletToPageMessage;

const closePort = (port: Runtime.Port): void => {
  try {
    port.disconnect();
  } catch {
    // The port is already unavailable.
  }
};

export const bootstrapContent = ({
  targetWindow = window,
  connectProviderPort = () => browser.runtime.connect({ name: DAPP_PROVIDER_PORT_NAME }),
}: BootstrapContentOptions = {}): void => {
  const pageOrigin = targetWindow.location.origin;
  const openedNamespaces = new Set<string>();
  let activePort: ActiveProviderPort | null = null;
  let recoveryAttempted = false;

  const sendToPage = (message: WalletToPageMessage): void => {
    targetWindow.postMessage(createContentToPageMessage(message), pageOrigin);
  };

  const releasePort = (expected: ActiveProviderPort): boolean => {
    if (activePort !== expected) {
      return false;
    }

    activePort = null;
    expected.unsubscribeMessage();
    expected.unsubscribeDisconnect();
    return true;
  };

  const connect = (): ActiveProviderPort | null => {
    let port: Runtime.Port;
    try {
      port = connectProviderPort();
    } catch {
      return null;
    }

    const channel = createPortChannel(port);
    const connection: ActiveProviderPort = {
      port,
      channel,
      unsubscribeMessage: () => undefined,
      unsubscribeDisconnect: () => undefined,
    };

    activePort = connection;
    connection.unsubscribeMessage = channel.onMessage((raw) => {
      if (activePort !== connection) {
        return;
      }

      const message = parseWalletToPageMessage(raw);
      if (message) {
        sendToPage(message);
      }
    });
    connection.unsubscribeDisconnect = channel.onDisconnect(() => {
      if (!releasePort(connection)) {
        return;
      }

      sendToPage(DISCONNECTED_MESSAGE);
      recoverOpenedNamespaces();
    });

    return connection;
  };

  const recoverOpenedNamespaces = (): void => {
    if (recoveryAttempted || openedNamespaces.size === 0) {
      return;
    }

    recoveryAttempted = true;
    const recoveredPort = connect();
    if (!recoveredPort) {
      return;
    }

    try {
      for (const namespace of openedNamespaces) {
        recoveredPort.channel.send({ type: "open", namespace } satisfies PageToWalletMessage);
      }
    } catch {
      releasePort(recoveredPort);
      closePort(recoveredPort.port);
    }
  };

  const forwardToBackground = (message: PageToWalletMessage): void => {
    if (message.type === "open") {
      openedNamespaces.add(message.namespace);
    }

    if (!activePort && recoveryAttempted) {
      return;
    }

    const connection = activePort ?? connect();
    if (!connection) {
      recoveryAttempted = true;
      sendToPage(DISCONNECTED_MESSAGE);
      return;
    }

    try {
      connection.channel.send(message);
    } catch {
      if (!releasePort(connection)) {
        return;
      }

      closePort(connection.port);
      sendToPage(DISCONNECTED_MESSAGE);
      recoverOpenedNamespaces();
    }
  };

  targetWindow.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== targetWindow || event.origin !== pageOrigin) {
      return;
    }

    const raw = readPageToContentMessage(event.data);
    if (raw === null) {
      return;
    }

    const message = parsePageToWalletMessage(raw);
    if (message) {
      forwardToBackground(message);
    }
  });
};
