import { CHANNEL } from "@arx/provider-extension/constants";
import type { Envelope } from "@arx/provider-extension/types";
import browser from "webextension-polyfill";
import { defineBackground } from "wxt/utils/define-background";

const DEFAULT_CHAIN = {
  chainId: "0x1",
  caip2: "eip155:1",
} as const;
export default defineBackground(() => {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== CHANNEL) return;

    const handleMessage = (message: unknown) => {
      const envelope = message as Envelope | undefined;

      if (!envelope || typeof envelope !== "object") return;

      if (envelope.channel !== CHANNEL) return;

      if (envelope.type === "handshake") {
        port.postMessage({ channel: CHANNEL, type: "handshake_ack", payload: DEFAULT_CHAIN } satisfies Envelope);
      }
    };

    port.onMessage.addListener(handleMessage);

    port.onDisconnect.addListener(() => {
      port.onMessage.removeListener(handleMessage);
    });
  });
});
