import browser from "webextension-polyfill";
import { CHANNEL } from "./constants.js";
import type { Envelope } from "./types.js";

export const bootstrapContent = () => {
  const port = browser.runtime.connect({ name: CHANNEL });

  const handleWindowMessage = (event: MessageEvent) => {
    if (event.source !== window) return;

    const data = event.data as Envelope | undefined;

    if (!data || typeof data !== "object" || data?.channel !== CHANNEL) return;

    if (data.type === "request" || data.type === "handshake") {
      port.postMessage(data);
    }
  };
  const handlePortMessage = (data: unknown) => {
    const envelope = data as Envelope | undefined;

    if (!envelope || typeof envelope !== "object" || envelope?.channel !== CHANNEL) return;

    window.postMessage(envelope, "*");
  };

  window.addEventListener("message", handleWindowMessage);
  port.onMessage.addListener(handlePortMessage);
  port.onDisconnect.addListener(() => {
    window.postMessage({ channel: CHANNEL, type: "event", payload: { event: "disconnect", params: [] } }, "*");
    window.removeEventListener("message", handleWindowMessage);
    port.onMessage.removeListener(handlePortMessage);
  });
};
