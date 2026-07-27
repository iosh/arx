import type { DuplexChannel } from "@arx/message-channel";
import type { Runtime } from "webextension-polyfill";

export const createRuntimePortChannel = (port: Runtime.Port): DuplexChannel => ({
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
