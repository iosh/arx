import { createLogger, extendLogger } from "@arx/core/logger";
import type { UiPortEnvelope } from "@arx/core/ui";
import type { WalletBridgeEvent, WalletBridgeReply } from "@arx/core/wallet/bridge";
import type browserDefaultType from "webextension-polyfill";

export type UiPort = browserDefaultType.Runtime.Port;
export type UiPortOutboundMessage = UiPortEnvelope | WalletBridgeReply | WalletBridgeEvent;

const uiLog = createLogger("bg:ui");
const portLog = extendLogger(uiLog, "port");

export const createUiPortHub = () => {
  const ports = new Set<UiPort>();
  const removePortListeners = new Map<UiPort, () => void>();

  const detach = (port: UiPort) => {
    const removeListeners = removePortListeners.get(port);
    removeListeners?.();
  };

  const send = (port: UiPort, envelope: UiPortOutboundMessage): boolean => {
    try {
      port.postMessage(envelope);
      return true;
    } catch (error) {
      portLog("drop stale UI port", error);
      detach(port);
      return false;
    }
  };

  const broadcast = (envelope: UiPortOutboundMessage) => {
    for (const port of Array.from(ports)) {
      send(port, envelope);
    }
  };

  const attach = (port: UiPort, onMessage: (raw: unknown) => void | Promise<void>) => {
    ports.add(port);

    const onMessageWrapped = (raw: unknown) => {
      // webextension event listeners don't await returned Promises; ensure rejections
      // don't become unhandled.
      return Promise.resolve()
        .then(() => onMessage(raw))
        .catch((error) => {
          portLog("UI port message handler failed", error);
        });
    };

    let removeListeners = () => {};
    const onDisconnect = () => removeListeners();

    removeListeners = () => {
      ports.delete(port);
      port.onMessage.removeListener(onMessageWrapped);
      port.onDisconnect.removeListener(onDisconnect);
      removePortListeners.delete(port);
    };

    port.onMessage.addListener(onMessageWrapped);
    port.onDisconnect.addListener(onDisconnect);
    removePortListeners.set(port, removeListeners);
  };

  return { attach, send, broadcast };
};
