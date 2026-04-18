import { ArxReasons, arxError } from "@arx/errors";
import type { WalletUi, WalletUiDispatchInput } from "../../engine/types.js";
import { createLogger, extendLogger } from "../../utils/logger.js";
import { UI_EVENT_SNAPSHOT_CHANGED } from "../protocol/events.js";
import type { UiMethodName } from "../protocol/index.js";
import { parseUiMethodParams, parseUiMethodResult } from "../protocol/index.js";
import { createUiDispatcher } from "./dispatcher.js";
import { getUiRequestBroadcastPolicy } from "./requestMetadata.js";
import { createUiServerRuntime } from "./runtime.js";
import type { UiHandlerFn, UiRuntimeAccess, UiRuntimeDeps, UiSurfaceIdentity } from "./types.js";

type CreateUiRuntimeAccessOptions = UiRuntimeDeps;

const uiLog = createLogger("ui:runtime");
const accessLog = extendLogger(uiLog, "access");
const UI_SURFACE_PORT_ID = "ui";

const requireUiHandler = <M extends UiMethodName>(
  handlers: ReturnType<typeof createUiServerRuntime>["handlers"],
  method: M,
): UiHandlerFn<M> => {
  const handler = handlers[method];
  if (!handler) {
    throw arxError({
      reason: ArxReasons.RpcUnsupportedMethod,
      message: `Unsupported UI method: ${method}`,
    });
  }

  return handler as UiHandlerFn<M>;
};

const createUiSurfaceIdentity = (uiOrigin: string): UiSurfaceIdentity => ({
  transport: "ui" as const,
  portId: UI_SURFACE_PORT_ID,
  origin: uiOrigin,
  surfaceId: crypto.randomUUID(),
});

const createUiStateChangedSubscription = ({
  bridge,
}: CreateUiRuntimeAccessOptions): UiRuntimeAccess["subscribeStateChanged"] => {
  return (listener) => {
    const notify = () => listener();
    const unsubs = [
      bridge.stateChanged.accounts.onStateChanged(notify),
      bridge.stateChanged.chains.onStateChanged(notify),
      bridge.stateChanged.approvals.onStateChanged(notify),
      bridge.stateChanged.permissions.onStateChanged(notify),
      bridge.stateChanged.transactions.onStateChanged(notify),
      bridge.stateChanged.chains.onSelectionChanged(notify),
      bridge.stateChanged.session.onStateChanged(notify),
      bridge.stateChanged.attention.onStateChanged(notify),
    ];

    return () => {
      unsubs.forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch (error) {
          accessLog("failed to remove ui runtime listener", error);
        }
      });
    };
  };
};

const createUiRuntimeCore = ({ server, bridge }: CreateUiRuntimeAccessOptions) => {
  const surface = createUiSurfaceIdentity(server.uiOrigin);
  const uiRuntime = createUiServerRuntime({
    access: server.access,
    platform: server.platform,
    surface,
    ...(server.extensions ? { extensions: server.extensions } : {}),
  });
  const subscribeStateChanged = createUiStateChangedSubscription({ server, bridge });

  const dispatch = (async <M extends UiMethodName>(input: WalletUiDispatchInput<M>) => {
    const handler = requireUiHandler(uiRuntime.handlers, input.method);
    const params = parseUiMethodParams(input.method, input.params);
    const result = await handler(params);
    return parseUiMethodResult(input.method, result);
  }) satisfies WalletUi["dispatch"];

  return {
    uiRuntime,
    subscribeStateChanged,
    dispatch,
  };
};

export const createUiContract = ({ server, bridge }: CreateUiRuntimeAccessOptions): WalletUi => {
  const { uiRuntime, subscribeStateChanged, dispatch } = createUiRuntimeCore({ server, bridge });

  return {
    buildSnapshot: () => uiRuntime.buildSnapshot(),
    dispatch,
    subscribeStateChanged,
  };
};

export const createUiRuntimeAccess = ({ server, bridge }: CreateUiRuntimeAccessOptions): UiRuntimeAccess => {
  const { uiRuntime, subscribeStateChanged } = createUiRuntimeCore({ server, bridge });

  const dispatcher = createUiDispatcher({
    handlers: uiRuntime.handlers,
    getUiContext: uiRuntime.getUiContext,
    encodeError: bridge.encodeError,
  });

  const dispatchRequest: UiRuntimeAccess["dispatchRequest"] = async (raw) => {
    const dispatched = await dispatcher.dispatch(raw);
    if (!dispatched) return null;

    if (dispatched.reply.type === "ui:response" && dispatched.plan.persistVaultMeta) {
      try {
        await bridge.persistVaultMeta();
      } catch (error) {
        accessLog("failed to persist vault meta", error);
      }
    }

    return {
      reply: dispatched.reply,
      shouldBroadcastSnapshot: dispatched.reply.type === "ui:response" && dispatched.plan.broadcastSnapshot,
    };
  };

  return {
    buildSnapshotEvent: () => ({
      type: "ui:event",
      event: UI_EVENT_SNAPSHOT_CHANGED,
      payload: uiRuntime.buildSnapshot(),
      context: uiRuntime.getUiContext(),
    }),
    dispatchRequest,
    getRequestBroadcastPolicy: (raw) => getUiRequestBroadcastPolicy(raw),
    subscribeStateChanged,
  };
};
