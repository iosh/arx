import { createLogger, extendLogger } from "../../utils/logger.js";
import { UI_EVENT_SNAPSHOT_CHANGED } from "../protocol/events.js";
import { createUiDispatcher } from "./dispatcher.js";
import { getUiRequestBroadcastPolicy } from "./requestMetadata.js";
import { createUiServerRuntime } from "./runtime.js";
import type { UiRuntimeAccess, UiRuntimeDeps, UiSurfaceIdentity } from "./types.js";

type CreateUiRuntimeAccessOptions = UiRuntimeDeps;

const uiLog = createLogger("ui:runtime");
const accessLog = extendLogger(uiLog, "access");
const UI_SURFACE_PORT_ID = "ui";

const createUiSurfaceIdentity = (surfaceOrigin: string): UiSurfaceIdentity => ({
  transport: "ui" as const,
  portId: UI_SURFACE_PORT_ID,
  origin: surfaceOrigin,
  surfaceId: crypto.randomUUID(),
});

export const createUiRuntimeAccess = ({ server, bridge }: CreateUiRuntimeAccessOptions): UiRuntimeAccess => {
  const surface = createUiSurfaceIdentity(server.surfaceOrigin);
  const uiRuntime = createUiServerRuntime({
    access: server.access,
    platform: server.platform,
    surface,
  });

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

  const subscribeStateChanged: UiRuntimeAccess["subscribeStateChanged"] = (listener) => {
    const notify = () => listener();
    const unsubs = [
      bridge.stateChanged.accounts.onStateChanged(notify),
      bridge.stateChanged.chains.onStateChanged(notify),
      bridge.stateChanged.approvals.onStateChanged(notify),
      bridge.stateChanged.permissions.onStateChanged(notify),
      bridge.stateChanged.transactions.onStateChanged(notify),
      bridge.stateChanged.chains.onPreferencesChanged(notify),
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
