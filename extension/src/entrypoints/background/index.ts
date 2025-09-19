import { CHANNEL } from "@arx/provider-extension/constants";
import type { Envelope } from "@arx/provider-extension/types";
import browser from "webextension-polyfill";
import { defineBackground } from "wxt/utils/define-background";

const DEFAULT_CHAIN = { chainId: "0x1", caip2: "eip155:1" } as const;
const DEFAULT_ACCOUNTS = ["0x0000000000000000000000000000000000000001"];

const postEnvelope = (port: browser.Runtime.Port, envelope: Envelope) => {
  port.postMessage(envelope);
};

export default defineBackground(() => {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== CHANNEL) return;

    const handleHandshake = () => {
      postEnvelope(port, {
        channel: CHANNEL,
        type: "handshake_ack",
        payload: {
          chainId: DEFAULT_CHAIN.chainId,
          accounts: DEFAULT_ACCOUNTS,
          isUnlocked: true,
        },
      });
    };

    postEnvelope(port, {
      channel: CHANNEL,
      type: "event",
      payload: { event: "accountsChanged", params: [DEFAULT_ACCOUNTS] },
    });

    postEnvelope(port, {
      channel: CHANNEL,
      type: "event",
      payload: { event: "chainChanged", params: [DEFAULT_CHAIN.chainId] },
    });

    const handleMessage = (message: unknown) => {
      const envelope = message as Envelope | undefined;
      if (!envelope || envelope.channel !== CHANNEL) return;

      switch (envelope.type) {
        case "handshake":
          handleHandshake();
          break;
        case "request":
          break;
        default:
          break;
      }
    };

    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(() => {
      port.onMessage.removeListener(handleMessage);
    });
  });
});
