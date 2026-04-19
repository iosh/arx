import { ArxReasons, arxError } from "@arx/errors";
import type { WalletUi, WalletUiDispatchInput } from "../../engine/types.js";
import { createLogger, extendLogger } from "../../utils/logger.js";
import {
  UI_EVENT_APPROVAL_DETAIL_CHANGED,
  UI_EVENT_APPROVALS_CHANGED,
  UI_EVENT_SNAPSHOT_CHANGED,
} from "../protocol/events.js";
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

const createUiSurfaceIdentity = (uiOrigin: string, createId: () => string): UiSurfaceIdentity => ({
  transport: "ui" as const,
  portId: UI_SURFACE_PORT_ID,
  origin: uiOrigin,
  surfaceId: createId(),
});

const createUiStateChangedSubscription = ({
  bridge,
}: CreateUiRuntimeAccessOptions): UiRuntimeAccess["subscribeStateChanged"] => {
  return (listener) => {
    const notify = () => listener();
    const unsubs = [
      bridge.stateChanged.accounts.onStateChanged(notify),
      bridge.stateChanged.chains.onStateChanged(notify),
      bridge.stateChanged.permissions.onStateChanged(notify),
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

const createUiEventSubscription = ({ server }: CreateUiRuntimeAccessOptions): UiRuntimeAccess["subscribeUiEvents"] => {
  return (listener) => {
    const emit = (event: ReturnType<UiRuntimeAccess["buildSnapshotEvent"]>) => {
      try {
        listener(event);
      } catch (error) {
        accessLog("ui event listener threw", error);
      }
    };

    const getContext = () => {
      const chain = server.access.chains.getSelectedChainView();
      return {
        namespace: chain.namespace,
        chainRef: chain.chainRef,
      };
    };

    const emitApprovalsChanged = () => {
      emit({
        type: "ui:event",
        event: UI_EVENT_APPROVALS_CHANGED,
        payload: { reason: "changed" },
        context: getContext(),
      });
    };

    const emitApprovalDetailChanged = (approvalId: string) => {
      emit({
        type: "ui:event",
        event: UI_EVENT_APPROVAL_DETAIL_CHANGED,
        payload: { approvalId },
        context: getContext(),
      });
    };

    const unsubs = [
      server.access.approvalEvents.onCreated(() => emitApprovalsChanged()),
      server.access.approvalEvents.onFinished(({ approvalId }) => {
        emitApprovalsChanged();
        emitApprovalDetailChanged(approvalId);
      }),
      server.access.transactionEvents.onStateChanged((change) => {
        const affectedApprovalIds = new Set<string>();
        for (const transactionId of change.transactionIds) {
          for (const approvalId of server.access.approvals.read.listAffectedApprovalIds({ transactionId })) {
            affectedApprovalIds.add(approvalId);
          }
        }
        for (const approvalId of affectedApprovalIds) {
          emitApprovalDetailChanged(approvalId);
        }
      }),
    ];

    return () => {
      for (const unsubscribe of unsubs) {
        try {
          unsubscribe();
        } catch (error) {
          accessLog("failed to remove ui event subscription", error);
        }
      }
    };
  };
};

const createUiRuntimeCore = ({ server, bridge }: CreateUiRuntimeAccessOptions) => {
  const surface = createUiSurfaceIdentity(server.uiOrigin, server.createId ?? (() => globalThis.crypto.randomUUID()));
  const uiRuntime = createUiServerRuntime({
    access: server.access,
    platform: server.platform,
    surface,
    ...(server.extensions ? { extensions: server.extensions } : {}),
  });
  const subscribeStateChanged = createUiStateChangedSubscription({ server, bridge });
  const subscribeUiEvents = createUiEventSubscription({ server, bridge });

  const dispatch = (async <M extends UiMethodName>(input: WalletUiDispatchInput<M>) => {
    const handler = requireUiHandler(uiRuntime.handlers, input.method);
    const params = parseUiMethodParams(input.method, input.params);
    const result = await handler(params);
    return parseUiMethodResult(input.method, result);
  }) satisfies WalletUi["dispatch"];

  return {
    uiRuntime,
    subscribeStateChanged,
    subscribeUiEvents,
    dispatch,
  };
};

export const createUiContract = ({ server, bridge }: CreateUiRuntimeAccessOptions): WalletUi => {
  const { uiRuntime, subscribeStateChanged, subscribeUiEvents, dispatch } = createUiRuntimeCore({ server, bridge });

  return {
    buildSnapshot: () => uiRuntime.buildSnapshot(),
    dispatch,
    subscribeStateChanged,
    subscribeUiEvents,
  };
};

export const createUiRuntimeAccess = ({ server, bridge }: CreateUiRuntimeAccessOptions): UiRuntimeAccess => {
  const { uiRuntime, subscribeStateChanged, subscribeUiEvents } = createUiRuntimeCore({ server, bridge });

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
    subscribeUiEvents,
  };
};
