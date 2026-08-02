import {
  type PageToWalletMessage,
  parsePageToWalletMessage,
  parseWalletToPageMessage,
  type WalletToPageMessage,
} from "@arx/provider/protocol";
import browser, { type Runtime } from "webextension-polyfill";
import { createPortChannel, waitForPortHost } from "@/transport/browserPort";
import { createContentToPageMessage, readPageToContentMessage } from "@/transport/inpageProviderChannel";
import { DAPP_PROVIDER_PORT_NAME } from "@/transport/portNames";

type ActiveProviderPort = {
  port: Runtime.Port;
  channel: ReturnType<typeof createPortChannel>;
  ready: boolean;
  unsubscribeMessage(): void;
  unsubscribeDisconnect(): void;
};

export type InstallProviderBridgeOptions = Readonly<{
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

export const installProviderBridge = ({
  targetWindow = window,
  connectProviderPort = () => browser.runtime.connect({ name: DAPP_PROVIDER_PORT_NAME }),
}: InstallProviderBridgeOptions = {}): void => {
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
      ready: false,
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
        if (message.type === "opened") {
          recoveryAttempted = false;
        }
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

    void waitForPortHost(port)
      .then(() => {
        if (activePort !== connection) {
          return;
        }

        connection.ready = true;
        try {
          for (const namespace of openedNamespaces) {
            connection.channel.send({ type: "open", namespace } satisfies PageToWalletMessage);
          }
        } catch {
          if (!releasePort(connection)) {
            return;
          }

          closePort(connection.port);
          sendToPage(DISCONNECTED_MESSAGE);
          recoverOpenedNamespaces();
        }
      })
      .catch(() => {
        // The channel disconnect listener owns transport failure and recovery.
      });

    return connection;
  };

  const recoverOpenedNamespaces = (): void => {
    if (recoveryAttempted || openedNamespaces.size === 0) {
      return;
    }

    recoveryAttempted = true;
    connect();
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

    if (!connection.ready) {
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
