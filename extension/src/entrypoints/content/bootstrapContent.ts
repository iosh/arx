import { CHANNEL, type Envelope } from "@arx/provider/protocol";
import browser, { type Runtime } from "webextension-polyfill";

export const bootstrapContent = () => {
  const DISCONNECT_ERROR = { code: 4900, message: "Disconnected" } as const;

  let port: Runtime.Port | null = null;
  let sessionId: string | null = null;

  const emitDisconnectEvent = (activeSessionId: string) => {
    window.postMessage(
      {
        channel: CHANNEL,
        sessionId: activeSessionId,
        type: "event",
        payload: { event: "disconnect", params: [DISCONNECT_ERROR] },
      },
      window.location.origin,
    );
  };

  const handlePortMessage = (data: unknown) => {
    const envelope = data as Envelope | undefined;
    if (!envelope || typeof envelope !== "object" || envelope?.channel !== CHANNEL) return;
    if (typeof envelope.sessionId !== "string") return;

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

  const portDisconnectHandlers = new WeakMap<Runtime.Port, () => void>();

  const detachPort = (target: Runtime.Port) => {
    target.onMessage.removeListener(handlePortMessage);
    const disconnectHandler = portDisconnectHandlers.get(target);
    if (disconnectHandler) {
      target.onDisconnect.removeListener(disconnectHandler);
      portDisconnectHandlers.delete(target);
    }
  };

  const attachPort = (nextPort: Runtime.Port) => {
    if (port && port !== nextPort) {
      try {
        detachPort(port);
        port.disconnect();
      } catch {
        // ignore port cleanup failures
      }
    }

    port = nextPort;

    nextPort.onMessage.addListener(handlePortMessage);
    const onDisconnect = () => {
      detachPort(nextPort);

      if (port === nextPort) {
        port = null;
      }

      const activeSessionId = sessionId;
      sessionId = null;
      if (activeSessionId) {
        emitDisconnectEvent(activeSessionId);
      }
    };
    portDisconnectHandlers.set(nextPort, onDisconnect);
    nextPort.onDisconnect.addListener(onDisconnect);
  };

  const getOrConnectPort = (): Runtime.Port => {
    if (port) return port;
    const nextPort = browser.runtime.connect({ name: CHANNEL });
    attachPort(nextPort);
    return nextPort;
  };

  const forwardToBackground = (envelope: Envelope) => {
    try {
      getOrConnectPort().postMessage(envelope);
    } catch (error) {
      const current = port;
      port = null;
      try {
        current?.disconnect();
      } catch {
        // ignore disconnect failure
      }
      try {
        getOrConnectPort().postMessage(envelope);
      } catch (retryError) {
        console.warn("[arx:content] failed to forward message to background", { error, retryError });
      }
    }
  };

  const handleWindowMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;

    const data = event.data as Envelope | undefined;
    if (!data || typeof data !== "object" || data?.channel !== CHANNEL) return;
    if (typeof data.sessionId !== "string") return;

    switch (data.type) {
      case "handshake":
        sessionId = data.sessionId;
        forwardToBackground(data);
        return;
      case "request":
        if (!sessionId) {
          sessionId = data.sessionId;
        }
        forwardToBackground(data);
        return;
      default:
        return;
    }
  };

  window.addEventListener("message", handleWindowMessage);

  // Initialize once; port may be recreated later by getOrConnectPort().
  getOrConnectPort();
};
