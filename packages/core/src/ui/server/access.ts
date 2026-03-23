import { createLogger, extendLogger } from "../../utils/logger.js";
import { UI_EVENT_SNAPSHOT_CHANGED } from "../protocol/events.js";
import { createUiDispatcher } from "./dispatcher.js";
import { getUiRequestEffects } from "./requestMetadata.js";
import { createUiServerRuntime } from "./runtime.js";
import type { UiRuntimeAccess, UiRuntimeDeps } from "./types.js";

type CreateUiRuntimeAccessOptions = UiRuntimeDeps;

const uiLog = createLogger("ui:runtime");
const accessLog = extendLogger(uiLog, "access");

export const createUiRuntimeAccess = ({ ...deps }: CreateUiRuntimeAccessOptions): UiRuntimeAccess => {
  const uiRuntime = createUiServerRuntime({
    ...deps,
  });

  const dispatcher = createUiDispatcher({
    handlers: uiRuntime.handlers,
    getUiContext: uiRuntime.getUiContext,
    errorEncoder: deps.errorEncoder,
  });

  const dispatchRequest: UiRuntimeAccess["dispatchRequest"] = async (raw) => {
    const dispatched = await dispatcher.dispatch(raw);
    if (!dispatched) return null;

    if (dispatched.reply.type === "ui:response" && dispatched.effects.persistVaultMeta) {
      try {
        await deps.session.persistVaultMeta();
      } catch (error) {
        accessLog("failed to persist vault meta", error);
      }
    }

    return {
      reply: dispatched.reply,
      shouldBroadcastSnapshot: dispatched.reply.type === "ui:response" && dispatched.effects.broadcastSnapshot,
    };
  };

  const subscribeStateChanged: UiRuntimeAccess["subscribeStateChanged"] = (listener) => {
    const notify = () => listener();
    const unsubs = [
      deps.accounts.onStateChanged(notify),
      deps.chains.onStateChanged(notify),
      deps.approvals.onStateChanged(notify),
      deps.permissions.onStateChanged(notify),
      deps.transactions.onStateChanged(notify),
      deps.chains.onPreferencesChanged(notify),
      deps.session.onStateChanged(notify),
      deps.attention.onStateChanged(notify),
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
    shouldHoldBroadcast: (raw) => Boolean(getUiRequestEffects(raw)?.holdBroadcast),
    subscribeStateChanged,
  };
};
