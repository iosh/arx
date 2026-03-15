import type { BackgroundRuntime } from "../../runtime/createBackgroundRuntime.js";
import { ATTENTION_STATE_CHANGED } from "../../services/runtime/attention/index.js";
import { createLogger, extendLogger } from "../../utils/logger.js";
import { UI_EVENT_SNAPSHOT_CHANGED } from "../protocol/events.js";
import { createUiDispatcher } from "./dispatcher.js";
import { getUiRequestEffects } from "./requestMetadata.js";
import { createUiServerRuntime } from "./runtime.js";
import type { UiPlatformAdapter, UiRuntimeAccess } from "./types.js";

type CreateUiRuntimeAccessOptions = {
  runtime: Pick<BackgroundRuntime, "bus" | "controllers" | "services" | "rpc">;
  platform: UiPlatformAdapter;
  uiOrigin: string;
};

const uiLog = createLogger("ui:runtime");
const accessLog = extendLogger(uiLog, "access");

export const createUiRuntimeAccess = ({
  runtime,
  platform,
  uiOrigin,
}: CreateUiRuntimeAccessOptions): UiRuntimeAccess => {
  const uiRuntime = createUiServerRuntime({
    controllers: runtime.controllers,
    chainActivation: runtime.services.chainActivation,
    chainViews: runtime.services.chainViews,
    permissionViews: runtime.services.permissionViews,
    accountCodecs: runtime.services.accountCodecs,
    session: runtime.services.session,
    keyring: runtime.services.keyring,
    attention: runtime.services.attention,
    namespaceBindings: runtime.services.namespaceBindings,
    rpcRegistry: runtime.rpc.registry,
    platform,
    uiOrigin,
  });

  const dispatcher = createUiDispatcher({
    handlers: uiRuntime.handlers,
    getUiContext: uiRuntime.getUiContext,
    rpcRegistry: runtime.rpc.registry,
  });

  const dispatchRequest: UiRuntimeAccess["dispatchRequest"] = async (raw) => {
    const dispatched = await dispatcher.dispatch(raw);
    if (!dispatched) return null;

    if (dispatched.reply.type === "ui:response" && dispatched.effects.persistVaultMeta) {
      try {
        await runtime.services.session.persistVaultMeta();
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
      runtime.controllers.accounts.onStateChanged(notify),
      runtime.controllers.network.onStateChanged(notify),
      runtime.controllers.approvals.onStateChanged(notify),
      runtime.controllers.permissions.onStateChanged(notify),
      runtime.controllers.transactions.onStateChanged(notify),
      runtime.services.networkPreferences.subscribeChanged(notify),
      runtime.services.session.unlock.onStateChanged(notify),
      runtime.bus.subscribe(ATTENTION_STATE_CHANGED, notify),
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
