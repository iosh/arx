import { isArxBaseError, type SerializedArxError, serializeArxError } from "@arx/core";
import {
  createMethodExecutor,
  type InvokeEvent,
  type InvokeFailure,
  type InvokeReady,
  type InvokeRequest,
  type InvokeResult,
  isInvokeRequest,
  type MethodExecutor,
} from "@arx/core/invoke";
import { createRpcInternalErrorFromUnknown, RpcInvalidRequestError } from "@arx/core/rpc";
import { WALLET_CHANGED_EVENT, WALLET_TARGET, type WalletEvent } from "@arx/core/wallet";
import type { Runtime } from "webextension-polyfill";
import {
  HOST_ENTRY_CHANGED_EVENT,
  HOST_TARGET,
  type HostApi,
  type HostMethods,
  hostMethodHandlers,
  type UiEntryLaunchContext,
} from "@/lib/host";
import type { BackgroundRuntimeHost } from "./runtimeHost";

type UiPort = Runtime.Port;
type UiPortMessage = InvokeReady | InvokeResult | InvokeFailure | InvokeEvent;

type BackgroundUiPort = Readonly<{
  start(): Promise<void>;
  destroy(): void;
  attachPort(port: UiPort): void;
  broadcastEntryChanged(entry: UiEntryLaunchContext): void;
}>;

const READY_MESSAGE = {
  kind: "ready",
} as const satisfies InvokeReady;

const encodeInvokeError = (error: unknown): SerializedArxError => {
  const domainError = isArxBaseError(error) ? error : createRpcInternalErrorFromUnknown(error);
  return serializeArxError(domainError);
};

const createFailureReply = (request: InvokeRequest, error: unknown): InvokeFailure => ({
  kind: "failure",
  target: request.target,
  id: request.id,
  error: encodeInvokeError(error),
});

export const createBackgroundUiPort = (deps: {
  runtimeHost: Pick<BackgroundRuntimeHost, "getOrInitWalletMethodExecutor" | "subscribeWalletEvents">;
  host: HostMethods;
}): BackgroundUiPort => {
  const ports = new Set<UiPort>();
  const removePortListeners = new Map<UiPort, () => void>();
  const hostExecutor = createMethodExecutor<HostMethods, HostApi>({
    context: deps.host,
    handlers: hostMethodHandlers,
  });
  let walletEventsUnsubscribe: (() => void) | null = null;
  let startPromise: Promise<void> | null = null;

  const detach = (port: UiPort) => {
    removePortListeners.get(port)?.();
  };

  const send = (port: UiPort, message: UiPortMessage): boolean => {
    try {
      port.postMessage(message);
      return true;
    } catch {
      detach(port);
      return false;
    }
  };

  const broadcast = (message: UiPortMessage) => {
    for (const port of Array.from(ports)) {
      send(port, message);
    }
  };

  const resolveExecutor = async (target: string): Promise<MethodExecutor> => {
    if (target === WALLET_TARGET) {
      return await deps.runtimeHost.getOrInitWalletMethodExecutor();
    }

    if (target === HOST_TARGET) {
      return hostExecutor;
    }

    throw new RpcInvalidRequestError({
      message: `Unknown UI target: ${target}`,
    });
  };

  const handleInvokeRequest = async (port: UiPort, request: InvokeRequest) => {
    const reply: InvokeResult | InvokeFailure = await resolveExecutor(request.target)
      .then(async (executor) => {
        const output = await executor.executePath(request.action, request.input);
        return {
          kind: "result",
          target: request.target,
          id: request.id,
          output,
        } as const satisfies InvokeResult;
      })
      .catch((error) => createFailureReply(request, error));

    send(port, reply);
  };

  const attachPort = (port: UiPort) => {
    if (removePortListeners.has(port)) {
      return;
    }

    ports.add(port);

    const onMessage = (raw: unknown) => {
      if (!isInvokeRequest(raw)) {
        return;
      }

      void handleInvokeRequest(port, raw);
    };

    const onDisconnect = () => {
      detach(port);
    };

    const removeListeners = () => {
      ports.delete(port);
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      removePortListeners.delete(port);
    };

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    removePortListeners.set(port, removeListeners);
    send(port, READY_MESSAGE);
  };

  const start = async () => {
    if (walletEventsUnsubscribe) {
      return;
    }

    if (startPromise) {
      return await startPromise;
    }

    startPromise = deps.runtimeHost
      .subscribeWalletEvents((event: WalletEvent) => {
        broadcast({
          kind: "event",
          target: WALLET_TARGET,
          name: WALLET_CHANGED_EVENT,
          payload: event,
        });
      })
      .then((unsubscribe) => {
        walletEventsUnsubscribe = unsubscribe;
      })
      .finally(() => {
        startPromise = null;
      });

    return await startPromise;
  };

  return {
    start,
    destroy: () => {
      walletEventsUnsubscribe?.();
      walletEventsUnsubscribe = null;

      for (const port of Array.from(ports)) {
        detach(port);
      }
    },
    attachPort,
    broadcastEntryChanged: (entry) => {
      broadcast({
        kind: "event",
        target: HOST_TARGET,
        name: HOST_ENTRY_CHANGED_EVENT,
        payload: entry,
      });
    },
  };
};
