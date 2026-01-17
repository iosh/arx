import type { UiPortEnvelope } from "@arx/core/ui";
import type browserDefaultType from "webextension-polyfill";

export type UiPort = browserDefaultType.Runtime.Port;

export const createUiPortHub = () => {
  const ports = new Set<UiPort>();
  const cleanups = new Map<UiPort, () => void>();

  const detach = (port: UiPort) => {
    const cleanup = cleanups.get(port);
    cleanup?.();
  };

  const send = (port: UiPort, envelope: UiPortEnvelope): boolean => {
    try {
      port.postMessage(envelope);
      return true;
    } catch (error) {
      console.warn("[uiBridge] drop stale UI port", error);
      detach(port);
      return false;
    }
  };

  const broadcast = (envelope: UiPortEnvelope) => {
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
          console.warn("[uiBridge] UI port message handler failed", error);
        });
    };

    let cleanup = () => {};
    const onDisconnect = () => cleanup();

    cleanup = () => {
      ports.delete(port);
      port.onMessage.removeListener(onMessageWrapped);
      port.onDisconnect.removeListener(onDisconnect);
      cleanups.delete(port);
    };

    port.onMessage.addListener(onMessageWrapped);
    port.onDisconnect.addListener(onDisconnect);
    cleanups.set(port, cleanup);
  };

  const teardown = () => {
    for (const cleanup of cleanups.values()) cleanup();
    ports.clear();
    cleanups.clear();
  };

  return { attach, send, broadcast, teardown };
};
