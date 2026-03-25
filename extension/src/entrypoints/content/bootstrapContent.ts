import { CHANNEL, type Envelope, PROVIDER_EVENTS } from "@arx/provider/protocol";
import browser, { type Runtime } from "webextension-polyfill";

type SessionPortEntry = {
  namespace: string;
  port: Runtime.Port;
  onMessage: (data: unknown) => void;
  onDisconnect: () => void;
};

const parseHandshakeNamespace = (envelope: Extract<Envelope, { type: "handshake" }>): string | null => {
  const namespace = envelope.payload.namespace.trim();
  return namespace ? namespace : null;
};

export const bootstrapContent = () => {
  const DISCONNECT_ERROR = { code: 4900, message: "Disconnected" } as const;

  const sessions = new Map<string, SessionPortEntry>();
  const latestSessionByNamespace = new Map<string, string>();

  const emitDisconnectEvent = (activeSessionId: string) => {
    window.postMessage(
      {
        channel: CHANNEL,
        sessionId: activeSessionId,
        type: "event",
        payload: { event: PROVIDER_EVENTS.disconnect, params: [DISCONNECT_ERROR] },
      },
      window.location.origin,
    );
  };

  const releaseSession = (sessionId: string): SessionPortEntry | null => {
    const entry = sessions.get(sessionId);
    if (!entry) return null;

    sessions.delete(sessionId);
    if (latestSessionByNamespace.get(entry.namespace) === sessionId) {
      latestSessionByNamespace.delete(entry.namespace);
    }

    try {
      entry.port.onMessage.removeListener(entry.onMessage);
      entry.port.onDisconnect.removeListener(entry.onDisconnect);
    } catch {
      // ignore cleanup failures
    }

    return entry;
  };

  const disconnectPort = (port: Runtime.Port) => {
    try {
      port.disconnect();
    } catch {
      // ignore disconnect failures
    }
  };

  const closeSession = (sessionId: string) => {
    const entry = releaseSession(sessionId);
    if (!entry) return;
    disconnectPort(entry.port);
  };

  const disconnectSession = (sessionId: string) => {
    if (!releaseSession(sessionId)) return;
    emitDisconnectEvent(sessionId);
  };

  const closeSessionWithDisconnectEvent = (sessionId: string) => {
    const entry = releaseSession(sessionId);
    if (!entry) return;
    disconnectPort(entry.port);
    emitDisconnectEvent(sessionId);
  };

  const finalizeSessionFromBackgroundDisconnect = (
    sessionId: string,
    envelope: Extract<Envelope, { type: "event" }>,
  ) => {
    const entry = releaseSession(sessionId);
    if (!entry) return;

    window.postMessage(envelope, window.location.origin);
    disconnectPort(entry.port);
  };

  const createSessionPort = (sessionId: string, namespace: string): SessionPortEntry => {
    const nextPort = browser.runtime.connect({ name: CHANNEL });
    const entry: SessionPortEntry = {
      namespace,
      port: nextPort,
      onMessage: (data: unknown) => {
        const envelope = data as Envelope | undefined;
        if (!envelope || typeof envelope !== "object" || envelope.channel !== CHANNEL) return;
        if (envelope.sessionId !== sessionId) return;

        switch (envelope.type) {
          case "handshake_ack":
          case "response":
            window.postMessage(envelope, window.location.origin);
            return;
          case "event":
            if (envelope.payload.event === PROVIDER_EVENTS.disconnect) {
              finalizeSessionFromBackgroundDisconnect(sessionId, envelope);
              return;
            }

            window.postMessage(envelope, window.location.origin);
            return;
          default:
            return;
        }
      },
      onDisconnect: () => {
        disconnectSession(sessionId);
      },
    };

    sessions.set(sessionId, entry);
    latestSessionByNamespace.set(namespace, sessionId);
    nextPort.onMessage.addListener(entry.onMessage);
    nextPort.onDisconnect.addListener(entry.onDisconnect);
    return entry;
  };

  const getOrCreateSessionPort = (sessionId: string, namespace: string): SessionPortEntry => {
    const existing = sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const previousSessionId = latestSessionByNamespace.get(namespace);
    if (previousSessionId && previousSessionId !== sessionId) {
      closeSession(previousSessionId);
    }

    return createSessionPort(sessionId, namespace);
  };

  const postToBackground = (envelope: Envelope) => {
    const sessionId = envelope.sessionId;
    const entry = sessions.get(sessionId);
    if (!entry) return false;

    try {
      entry.port.postMessage(envelope);
      return true;
    } catch (error) {
      closeSessionWithDisconnectEvent(sessionId);
      console.warn("[arx:content] failed to forward message to background", { error, sessionId });
      return false;
    }
  };

  const handleWindowMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;

    const data = event.data as Envelope | undefined;
    if (!data || typeof data !== "object" || data.channel !== CHANNEL) return;
    if (typeof data.sessionId !== "string") return;

    switch (data.type) {
      case "handshake": {
        const namespace = parseHandshakeNamespace(data);
        if (!namespace) return;
        getOrCreateSessionPort(data.sessionId, namespace);
        postToBackground(data);
        return;
      }

      case "request":
        postToBackground(data);
        return;

      default:
        return;
    }
  };

  window.addEventListener("message", handleWindowMessage);
};
