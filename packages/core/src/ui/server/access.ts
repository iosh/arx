import type { WalletUi, WalletUiDispatchInput } from "../../engine/types.js";
import { RpcUnsupportedMethodError } from "../../rpc/errors.js";
import { createLogger, extendLogger } from "../../utils/logger.js";
import {
  UI_EVENT_APPROVAL_DETAIL_CHANGED,
  UI_EVENT_APPROVALS_CHANGED,
  UI_EVENT_SNAPSHOT_CHANGED,
  UI_EVENT_TRANSACTIONS_CHANGED,
} from "../protocol/events.js";
import type { UiMethodName } from "../protocol/index.js";
import { parseUiMethodParams } from "../protocol/index.js";
import { createUiDispatcher } from "./dispatcher.js";
import { getUiRequestExecutionPlan } from "./requestMetadata.js";
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
    throw new RpcUnsupportedMethodError({
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
  server,
}: CreateUiRuntimeAccessOptions): UiRuntimeAccess["subscribeStateChanged"] => {
  return (listener) => server.wallet.snapshot.subscribe(listener);
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
      const chain = server.wallet.snapshot.get().chain;
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
    const emitTransactionsChanged = (transactionIds: readonly string[]) => {
      const uniqueTransactionIds = Array.from(new Set(transactionIds));
      if (uniqueTransactionIds.length === 0) {
        return;
      }
      emit({
        type: "ui:event",
        event: UI_EVENT_TRANSACTIONS_CHANGED,
        payload: { transactionIds: uniqueTransactionIds },
        context: getContext(),
      });
    };
    const unsubs = [
      server.events.onApprovalCreated(() => emitApprovalsChanged()),
      server.events.onApprovalFinished((event) => {
        emitApprovalsChanged();
        emitApprovalDetailChanged(event.approvalId);
      }),
      server.events.onTransactionApprovalsChanged((approvalIds) => {
        const uniqueApprovalIds = Array.from(new Set(approvalIds));
        emitApprovalsChanged();
        for (const approvalId of uniqueApprovalIds) {
          emitApprovalDetailChanged(approvalId);
        }
      }),
      server.events.onTransactionsChanged((transactionIds) => {
        emitTransactionsChanged(transactionIds);
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

const createUiRuntimeCore = ({ server }: CreateUiRuntimeAccessOptions) => {
  const surface = createUiSurfaceIdentity(server.uiOrigin, server.createId ?? (() => globalThis.crypto.randomUUID()));
  const uiRuntime = createUiServerRuntime({
    wallet: server.wallet,
    platform: server.platform,
    surface,
    ...(server.extensions ? { extensions: server.extensions } : {}),
  });
  const subscribeStateChanged = createUiStateChangedSubscription({ server });
  const subscribeUiEvents = createUiEventSubscription({ server });

  const dispatch = (async <M extends UiMethodName>(input: WalletUiDispatchInput<M>) => {
    const handler = requireUiHandler(uiRuntime.handlers, input.method);
    const params = parseUiMethodParams(input.method, input.params);
    const result = await handler(params);
    return result;
  }) satisfies WalletUi["dispatch"];

  return {
    uiRuntime,
    subscribeStateChanged,
    subscribeUiEvents,
    dispatch,
  };
};

export const createUiContract = (options: CreateUiRuntimeAccessOptions): WalletUi => {
  const { uiRuntime, subscribeStateChanged, subscribeUiEvents, dispatch } = createUiRuntimeCore(options);

  return {
    buildSnapshot: () => uiRuntime.buildSnapshot(),
    dispatch,
    subscribeStateChanged,
    subscribeUiEvents,
  };
};

export const createUiRuntimeAccess = (options: CreateUiRuntimeAccessOptions): UiRuntimeAccess => {
  const { uiRuntime, subscribeStateChanged, subscribeUiEvents } = createUiRuntimeCore(options);

  const dispatcher = createUiDispatcher({
    handlers: uiRuntime.handlers,
    getUiContext: uiRuntime.getUiContext,
  });

  const dispatchRequest: UiRuntimeAccess["dispatchRequest"] = async (raw) => {
    const dispatched = await dispatcher.dispatch(raw);
    if (!dispatched) return null;

    return {
      reply: dispatched.reply,
      kind: dispatched.plan.kind,
    };
  };

  return {
    buildSnapshotEvent: () => {
      const snapshot = uiRuntime.buildSnapshot();
      return {
        type: "ui:event",
        event: UI_EVENT_SNAPSHOT_CHANGED,
        payload: snapshot,
        context: {
          namespace: snapshot.chain.namespace,
          chainRef: snapshot.chain.chainRef,
        },
      };
    },
    dispatchRequest,
    getRequestKind: (raw) => getUiRequestExecutionPlan(raw)?.kind ?? null,
    subscribeStateChanged,
    subscribeUiEvents,
  };
};
