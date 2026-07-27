import type { DappTransportHost } from "@arx/provider/host";
import type { WalletHost } from "@arx/wallet-api/host";
import type { Runtime } from "webextension-polyfill";
import { createRuntimePortChannel } from "@/platform/browser/runtimePortChannel";
import { DAPP_PROVIDER_PORT_NAME, WALLET_UI_PORT_NAME } from "@/platform/browser/runtimePortNames";

export type BrowserChannelHosts = Readonly<{
  wallet: WalletHost;
  dapp: DappTransportHost;
}>;

export type AttachBrowserPortOptions = Readonly<{
  port: Runtime.Port;
  extensionUrl: string;
  runtimeId: string;
  hosts: BrowserChannelHosts;
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

export const readDappOrigin = (port: Runtime.Port): string | null => {
  const senderUrl = parseUrl(port.sender?.url);
  if (!senderUrl || (senderUrl.protocol !== "http:" && senderUrl.protocol !== "https:")) {
    return null;
  }

  return senderUrl.origin;
};

export const isTrustedWalletUiPort = (
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

const rejectPort = (port: Runtime.Port): void => {
  try {
    port.disconnect();
  } catch {
    // The untrusted port is already unusable.
  }
};

export const attachBrowserPort = ({ port, extensionUrl, runtimeId, hosts }: AttachBrowserPortOptions): boolean => {
  if (port.name === WALLET_UI_PORT_NAME) {
    if (!isTrustedWalletUiPort(port, { extensionUrl, runtimeId })) {
      rejectPort(port);
      return false;
    }

    hosts.wallet.attach(createRuntimePortChannel(port));
    return true;
  }

  if (port.name === DAPP_PROVIDER_PORT_NAME) {
    if (port.sender?.id !== runtimeId) {
      rejectPort(port);
      return false;
    }

    const origin = readDappOrigin(port);
    if (!origin) {
      rejectPort(port);
      return false;
    }

    hosts.dapp.attach({ channel: createRuntimePortChannel(port), origin });
    return true;
  }

  return false;
};
