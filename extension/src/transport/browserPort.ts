import type { DuplexChannel } from "@arx/message-channel";
import type { Runtime } from "webextension-polyfill";

export const PORT_HOST_READY_MESSAGE = {
  type: "arx:port-host-ready",
} as const;

const isPortHostReadyMessage = (value: unknown): boolean => {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === PORT_HOST_READY_MESSAGE.type
  );
};

export const createPortChannel = (port: Runtime.Port): DuplexChannel => ({
  send(message) {
    port.postMessage(message);
  },
  onMessage(listener) {
    const onMessage = (message: unknown) => listener(message);
    port.onMessage.addListener(onMessage);

    return () => {
      port.onMessage.removeListener(onMessage);
    };
  },
  onDisconnect(listener) {
    const onDisconnect = () => listener();
    port.onDisconnect.addListener(onDisconnect);

    return () => {
      port.onDisconnect.removeListener(onDisconnect);
    };
  },
});

export const waitForPortHost = (port: Runtime.Port): Promise<void> => {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
    };
    const onMessage = (message: unknown) => {
      if (!isPortHostReadyMessage(message)) {
        return;
      }

      cleanup();
      resolve();
    };
    const onDisconnect = () => {
      cleanup();
      reject(new Error("Browser port disconnected before its host was ready."));
    };

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
  });
};
