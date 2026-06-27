import { ArxBaseError } from "@arx/core";
import { type InvokeChannel, isInvokeReady } from "@arx/core/invoke";
import type Browser from "webextension-polyfill";
import { UI_CHANNEL } from "@/lib/host";

type DisconnectListener = (error?: unknown) => void;

export class UiPortError extends ArxBaseError {
  static readonly code = "ui.port";

  readonly reason: "connect-failed" | "connect-timeout" | "disconnected" | "not-connected" | "not-ready";

  constructor(input: {
    reason: "connect-failed" | "connect-timeout" | "disconnected" | "not-connected" | "not-ready";
    cause?: unknown;
  }) {
    super(`UI port error: ${input.reason}`, {
      code: UiPortError.code,
      details: {
        reason: input.reason,
      },
      cause: input.cause,
    });
    this.reason = input.reason;
  }
}

type BrowserApi = typeof Browser;

const CONNECT_READY_TIMEOUT_MS = 30_000;

const tryCall = (fn: () => void) => {
  try {
    fn();
  } catch {
    // best-effort cleanup
  }
};

export const createUiPort = (deps?: { browser?: BrowserApi }): InvokeChannel => {
  let browserPromise: Promise<BrowserApi> | null = null;
  const getBrowser = async (): Promise<BrowserApi> => {
    if (deps?.browser) {
      return deps.browser;
    }

    browserPromise ??= import("webextension-polyfill").then((module) => {
      const loaded = module as unknown as { default?: unknown };
      return (loaded.default ?? module) as unknown as BrowserApi;
    });
    return await browserPromise;
  };

  let port: Browser.Runtime.Port | null = null;
  let connectGeneration = 0;
  let ready = false;
  let connectPromise: Promise<void> | null = null;
  let connectResolve: (() => void) | null = null;
  let connectReject: ((error: UiPortError) => void) | null = null;
  let connectTimeout: ReturnType<typeof setTimeout> | null = null;

  const messageListeners = new Set<(message: unknown) => void>();
  const disconnectListeners = new Set<DisconnectListener>();

  const clearConnectWaiter = () => {
    connectResolve = null;
    connectReject = null;
    if (!connectTimeout) {
      return;
    }

    clearTimeout(connectTimeout);
    connectTimeout = null;
  };

  const resolveConnectWaiter = () => {
    const resolve = connectResolve;
    clearConnectWaiter();
    resolve?.();
  };

  const rejectConnectWaiter = (error: UiPortError) => {
    const reject = connectReject;
    clearConnectWaiter();
    reject?.(error);
  };

  const onPortMessage = (message: unknown, fromPort: Browser.Runtime.Port) => {
    if (fromPort !== port) {
      return;
    }

    if (!ready && isInvokeReady(message)) {
      ready = true;
      resolveConnectWaiter();
    }

    for (const listener of messageListeners) {
      listener(message);
    }
  };

  const unbindPort = (activePort: Browser.Runtime.Port) => {
    tryCall(() => activePort.onMessage.removeListener(onPortMessage));
    tryCall(() => activePort.onDisconnect.removeListener(onPortDisconnect));
  };

  const onPortDisconnect = (fromPort: Browser.Runtime.Port) => {
    if (fromPort !== port) {
      return;
    }

    connectGeneration += 1;
    const disconnectCause = fromPort.error;
    const activePort = fromPort;
    port = null;
    ready = false;
    rejectConnectWaiter(
      new UiPortError({
        reason: "disconnected",
        cause: disconnectCause,
      }),
    );
    unbindPort(activePort);

    for (const listener of disconnectListeners) {
      listener(disconnectCause);
    }
  };

  const bindPort = (activePort: Browser.Runtime.Port) => {
    activePort.onMessage.addListener(onPortMessage);
    activePort.onDisconnect.addListener(onPortDisconnect);
  };

  const connect = async () => {
    if (port && ready) {
      return;
    }

    if (connectPromise) {
      return await connectPromise;
    }

    const generation = connectGeneration;
    const pendingConnect = new Promise<void>((resolve, reject) => {
      connectResolve = resolve;
      connectReject = reject;
      connectTimeout = setTimeout(() => {
        connectGeneration += 1;
        const activePort = port;
        port = null;
        ready = false;

        if (activePort) {
          unbindPort(activePort);
          tryCall(() => activePort.disconnect());
        }

        rejectConnectWaiter(
          new UiPortError({
            reason: "connect-timeout",
          }),
        );
      }, CONNECT_READY_TIMEOUT_MS);
    }).finally(() => {
      clearConnectWaiter();
      connectPromise = null;
    });

    connectPromise = pendingConnect;

    try {
      if (!port) {
        const browser = await getBrowser();
        if (connectGeneration !== generation) {
          return await pendingConnect;
        }

        const nextPort = browser.runtime.connect({ name: UI_CHANNEL });
        if (connectGeneration !== generation) {
          tryCall(() => nextPort.disconnect());
          return await pendingConnect;
        }

        port = nextPort;
        ready = false;
        bindPort(nextPort);
      }
    } catch (error) {
      const uiPortError = new UiPortError({
        reason: "connect-failed",
        cause: error,
      });
      rejectConnectWaiter(uiPortError);
      throw uiPortError;
    }

    return await pendingConnect;
  };

  return {
    connect,
    disconnect: () => {
      const activePort = port;
      connectGeneration += 1;
      port = null;
      ready = false;
      rejectConnectWaiter(
        new UiPortError({
          reason: "disconnected",
          cause: activePort?.error,
        }),
      );

      if (!activePort) {
        return;
      }

      unbindPort(activePort);
      tryCall(() => activePort.disconnect());
    },
    postMessage: (message) => {
      if (!port) {
        throw new UiPortError({
          reason: "not-connected",
        });
      }

      if (!ready) {
        throw new UiPortError({
          reason: "not-ready",
        });
      }

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
  };
};
