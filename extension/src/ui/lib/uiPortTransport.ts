import type { UiTransport } from "@arx/core/ui";
import { UI_CHANNEL, type UiPortEnvelope } from "@arx/core/ui";
import browser from "webextension-polyfill";

type UnknownListener = (message: unknown) => void;
type DisconnectListener = (error?: unknown) => void;
// Port-based transport for browser extension UI.
// Keeps transport state local and re-binds listeners on reconnect.

export const createUiPortTransport = (): UiTransport => {
  let port: browser.Runtime.Port | null = null;

  const messageListeners = new Set<UnknownListener>();
  const disconnectListeners = new Set<DisconnectListener>();

  const onPortMessage = (message: unknown) => {
    for (const fn of messageListeners) fn(message);
  };

  const onPortDisconnect = () => {
    const err = port?.error;
    const prev = port;
    port = null;

    if (prev) unbindPort(prev);

    for (const fn of disconnectListeners) fn(err);
  };

  const bindPort = (p: browser.Runtime.Port) => {
    p.onMessage.addListener(onPortMessage);
    p.onDisconnect.addListener(onPortDisconnect);
  };

  const unbindPort = (p: browser.Runtime.Port) => {
    try {
      p.onMessage.removeListener(onPortMessage);
    } catch {
      // best-effort
    }
    try {
      p.onDisconnect.removeListener(onPortDisconnect);
    } catch {
      // best-effort
    }
  };

  const connect = async () => {
    if (port) return;

    const p = browser.runtime.connect({ name: UI_CHANNEL });
    port = p;

    // Must bind listeners before resolving connect(), so the client won't miss
    // an early snapshot event sent immediately after connection.
    bindPort(p);
  };

  return {
    connect,

    disconnect: () => {
      const prev = port;
      port = null;

      if (prev) {
        unbindPort(prev);
        try {
          prev.disconnect();
        } catch {
          // best-effort
        }
      }
    },

    postMessage: (message: UiPortEnvelope) => {
      if (!port) throw new Error("UI transport is not connected");
      port.postMessage(message);
    },

    onMessage: (listener) => {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },

    onDisconnect: (listener) => {
      disconnectListeners.add(listener);
      return () => disconnectListeners.delete(listener);
    },

    isConnected: () => port !== null,
  };
};
