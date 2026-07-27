import type { DisconnectListener, DuplexChannel, MessageListener } from "@arx/message-channel";
import type { DappTransportHost } from "@arx/provider/host";
import type { WalletHost } from "@arx/wallet-api/host";
import type { Runtime } from "webextension-polyfill";
import { DAPP_PROVIDER_PORT_NAME, WALLET_UI_PORT_NAME } from "@/platform/browser/runtimePortNames";
import { isWalletUiInputMessage } from "@/platform/browser/walletUiInput";

export type BrowserChannelHosts = Readonly<{
  wallet: WalletHost;
  dapp: DappTransportHost;
}>;

export type PendingBrowserPort = Readonly<{
  attach(hosts: BrowserChannelHosts): void;
  reject(): void;
}>;

type AcceptBrowserPortOptions = Readonly<{
  port: Runtime.Port;
  extensionUrl: string;
  runtimeId: string;
  onWalletUiInput(): void;
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

const readDappOrigin = (port: Runtime.Port): string | null => {
  const senderUrl = parseUrl(port.sender?.url);
  if (!senderUrl || (senderUrl.protocol !== "http:" && senderUrl.protocol !== "https:")) {
    return null;
  }

  return senderUrl.origin;
};

const isTrustedWalletUiPort = (
  port: Runtime.Port,
  input: Readonly<{ extensionUrl: string; runtimeId: string }>,
): boolean => {
  if (port.sender?.id !== input.runtimeId) {
    return false;
  }

  const senderUrl = parseUrl(port.sender.url);
  const extensionUrl = parseUrl(input.extensionUrl);
  return Boolean(
    senderUrl && extensionUrl && senderUrl.protocol === extensionUrl.protocol && senderUrl.host === extensionUrl.host,
  );
};

const disconnectPort = (port: Runtime.Port): void => {
  try {
    port.disconnect();
  } catch {
    // The port is already unavailable.
  }
};

const createPendingBrowserPort = (
  port: Runtime.Port,
  attachHost: (hosts: BrowserChannelHosts, channel: DuplexChannel) => void,
  consumeMessage?: (message: unknown) => boolean,
): PendingBrowserPort => {
  const pendingMessages: unknown[] = [];
  const messageListeners = new Set<MessageListener>();
  const disconnectListeners = new Set<DisconnectListener>();
  let status: "pending" | "attached" | "rejected" = "pending";
  let disconnected = false;

  const publishMessage = (message: unknown) => {
    if (consumeMessage?.(message)) {
      return;
    }

    for (const listener of [...messageListeners]) {
      listener(message);
    }
  };

  const publishDisconnect = () => {
    for (const listener of [...disconnectListeners]) {
      listener();
    }
  };

  const removePortListeners = () => {
    port.onMessage.removeListener(onMessage);
    port.onDisconnect.removeListener(onDisconnect);
  };

  const onMessage = (message: unknown) => {
    if (status === "attached") {
      publishMessage(message);
      return;
    }

    if (status === "pending") {
      pendingMessages.push(message);
    }
  };

  const onDisconnect = () => {
    if (disconnected || status === "rejected") {
      return;
    }

    disconnected = true;
    removePortListeners();
    if (status === "attached") {
      publishDisconnect();
    }
  };

  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(onDisconnect);

  const channel: DuplexChannel = {
    send: (message) => port.postMessage(message),
    onMessage: (listener) => {
      messageListeners.add(listener);
      return () => {
        messageListeners.delete(listener);
      };
    },
    onDisconnect: (listener) => {
      disconnectListeners.add(listener);
      return () => {
        disconnectListeners.delete(listener);
      };
    },
  };

  return {
    attach(hosts) {
      if (status !== "pending") {
        return;
      }

      attachHost(hosts, channel);
      status = "attached";
      for (const message of pendingMessages.splice(0)) {
        publishMessage(message);
      }
      if (disconnected) {
        publishDisconnect();
      }
    },
    reject() {
      if (status !== "pending") {
        return;
      }

      status = "rejected";
      pendingMessages.splice(0);
      removePortListeners();
      if (!disconnected) {
        disconnectPort(port);
      }
    },
  };
};

export const acceptBrowserPort = ({
  port,
  extensionUrl,
  runtimeId,
  onWalletUiInput,
}: AcceptBrowserPortOptions): PendingBrowserPort | null => {
  if (port.name === WALLET_UI_PORT_NAME) {
    if (!isTrustedWalletUiPort(port, { extensionUrl, runtimeId })) {
      disconnectPort(port);
      return null;
    }

    return createPendingBrowserPort(
      port,
      (hosts, channel) => hosts.wallet.attach(channel),
      (message) => {
        if (!isWalletUiInputMessage(message)) {
          return false;
        }

        onWalletUiInput();
        return true;
      },
    );
  }

  if (port.name === DAPP_PROVIDER_PORT_NAME) {
    if (port.sender?.id !== runtimeId) {
      disconnectPort(port);
      return null;
    }

    const origin = readDappOrigin(port);
    if (!origin) {
      disconnectPort(port);
      return null;
    }

    return createPendingBrowserPort(port, (hosts, channel) => hosts.dapp.attach({ channel, origin }));
  }

  return null;
};
