import type { UiTransport } from "@arx/core/ui";
import { UI_CHANNEL, type UiPortEnvelope } from "@arx/core/ui";
import type Browser from "webextension-polyfill";

type UnknownListener = (message: unknown) => void;
type DisconnectListener = (error?: unknown) => void;
// Port-based transport for browser extension UI.
// Keeps transport state local and re-binds listeners on reconnect.

type BrowserApi = typeof Browser;

const CONNECT_READY_TIMEOUT_MS = 30_000;

const tryCall = (fn: () => void) => {
  try {
    fn();
  } catch {
    // best-effort
  }
};

const toError = (message: string, cause?: unknown): Error => {
  const err = new Error(message);
  if (cause !== undefined) (err as { cause?: unknown }).cause = cause;
  return err;
};

export const createUiPortTransport = (deps?: { browser?: BrowserApi }): UiTransport => {
  let browserPromise: Promise<BrowserApi> | null = null;
  const getBrowser = async (): Promise<BrowserApi> => {
    if (deps?.browser) return deps.browser;

    browserPromise ??= import("webextension-polyfill").then((m) => {
      const mod = m as unknown as { default?: unknown };
      return (mod.default ?? m) as unknown as BrowserApi;
    });
    return await browserPromise;
  };

  let port: Browser.Runtime.Port | null = null;
  // Used to invalidate any in-flight connect() work across awaits (e.g. dynamic import).
  let connectGen = 0;
  // MV3 cold-start: popup can run before the service worker has attached its
  // port listeners. Treat connect() as ready only after the first inbound message
  // arrives (BG sends an initial snapshot event on attach).
  let ready = false;
  let connectPromise: Promise<void> | null = null;
  let connectResolve: (() => void) | null = null;
  let connectReject: ((error: Error) => void) | null = null;
  let connectTimeout: ReturnType<typeof setTimeout> | null = null;

  const messageListeners = new Set<UnknownListener>();
  const disconnectListeners = new Set<DisconnectListener>();

  const clearConnectWaiter = () => {
    connectResolve = null;
    connectReject = null;
    if (connectTimeout) {
      clearTimeout(connectTimeout);
      connectTimeout = null;
    }
  };

  const resolveConnectWaiter = () => {
    const resolve = connectResolve;
    clearConnectWaiter();
    resolve?.();
  };

  const rejectConnectWaiter = (error: Error) => {
    const reject = connectReject;
    clearConnectWaiter();
    reject?.(error);
  };

  const onPortMessage = (message: unknown, fromPort: Browser.Runtime.Port) => {
    if (fromPort !== port) return;
    if (!ready) {
      ready = true;
      resolveConnectWaiter();
    }
    for (const fn of messageListeners) fn(message);
  };

  const onPortDisconnect = (fromPort: Browser.Runtime.Port) => {
    if (fromPort !== port) return;
    connectGen += 1;
    const err = fromPort.error;
    const prev = fromPort;
    port = null;
    ready = false;
    rejectConnectWaiter(toError("UI transport disconnected", err));

    if (prev) unbindPort(prev);

    for (const fn of disconnectListeners) fn(err);
  };

  const bindPort = (p: Browser.Runtime.Port) => {
    p.onMessage.addListener(onPortMessage);
    p.onDisconnect.addListener(onPortDisconnect);
  };

  const unbindPort = (p: Browser.Runtime.Port) => {
    tryCall(() => p.onMessage.removeListener(onPortMessage));
    tryCall(() => p.onDisconnect.removeListener(onPortDisconnect));
  };

  const connect = async () => {
    if (port && ready) return;
    if (connectPromise) return await connectPromise;

    const gen = connectGen;

    connectPromise = new Promise<void>((resolve, reject) => {
      connectResolve = resolve;
      connectReject = reject;
      // Don't wait forever if the service worker is wedged.
      connectTimeout = setTimeout(() => {
        connectGen += 1;
        // Force a disconnect so a subsequent retry creates a fresh port.
        const prev = port;
        port = null;
        ready = false;
        if (prev) {
          unbindPort(prev);
          tryCall(() => prev.disconnect());
        }
        rejectConnectWaiter(toError("UI transport connect timed out waiting for initial message"));
      }, CONNECT_READY_TIMEOUT_MS);
    }).finally(() => {
      clearConnectWaiter();
      connectPromise = null;
    });

    // Keep a stable reference: connectPromise can be cleared by .finally() during races.
    const pending = connectPromise;
    if (!pending) throw new Error("UI transport connect invariant violated");

    try {
      if (!port) {
        const browser = await getBrowser();
        if (connectGen !== gen) return await pending;

        const p = browser.runtime.connect({ name: UI_CHANNEL });
        if (connectGen !== gen) {
          tryCall(() => p.disconnect());
          return await pending;
        }
        port = p;
        ready = false;

        // Must bind listeners immediately so we don't miss the initial snapshot event.
        bindPort(p);
      }
    } catch (error) {
      const err = toError("UI transport connect failed", error);
      rejectConnectWaiter(err);
      throw err;
    }

    return await pending;
  };

  return {
    connect,

    disconnect: () => {
      const prev = port;
      connectGen += 1;
      port = null;
      ready = false;
      rejectConnectWaiter(toError("UI transport disconnected", prev?.error));

      if (prev) {
        unbindPort(prev);
        tryCall(() => prev.disconnect());
      }
    },

    postMessage: (message: UiPortEnvelope) => {
      if (!port) throw new Error("UI transport is not connected");
      if (!ready) throw new Error("UI transport is not ready (await connect())");
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

    // "Connected" here means the port exists and we've seen the first inbound
    // message (i.e. BG listener is attached and the bridge is ready).
    isConnected: () => port !== null && ready,
  };
};
