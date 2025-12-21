import { CHANNEL, type Envelope } from "@arx/provider/protocol";
import browser from "webextension-polyfill";

export const bootstrapContent = () => {
  const port = browser.runtime.connect({ name: CHANNEL });
  let sessionId: string | null = null;

  const handleWindowMessage = (event: MessageEvent) => {
    if (event.source !== window) return;

    const data = event.data as Envelope | undefined;
    if (!data || typeof data !== "object" || data?.channel !== CHANNEL) return;
    sessionId = data.sessionId;

    switch (data.type) {
      case "handshake":
      case "request":
        port.postMessage(data);
        return;
      default:
        return;
    }
  };

  const handlePortMessage = (data: unknown) => {
    const envelope = data as Envelope | undefined;
    if (!envelope || typeof envelope !== "object" || envelope?.channel !== CHANNEL) return;

    switch (envelope.type) {
      case "handshake_ack":
      case "response":
      case "event":
        window.postMessage(envelope, window.location.origin);
        return;
      default:
        return;
    }
  };

  window.addEventListener("message", handleWindowMessage);
  port.onMessage.addListener(handlePortMessage);
  port.onDisconnect.addListener(() => {
    if (sessionId) {
      window.postMessage(
        { channel: CHANNEL, sessionId, type: "event", payload: { event: "disconnect", params: [] } },
        window.location.origin,
      );
    }
    window.removeEventListener("message", handleWindowMessage);
    port.onMessage.removeListener(handlePortMessage);
  });
};
