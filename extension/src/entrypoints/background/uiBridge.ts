import type {
  AttentionService,
  BackgroundSessionServices,
  ChainService,
  HandlerControllers,
  KeyringService,
  RpcClientRegistry,
  RpcRegistry,
} from "@arx/core";
import { createUiDispatcher, type UiDispatchOutput } from "@arx/core/ui/server";

import type browserDefaultType from "webextension-polyfill";
import type { UiPlatform } from "./platform/uiPlatform";
import { createUiPortHub } from "./ui/portHub";

export { UI_CHANNEL } from "@arx/core/ui";

type BridgeDeps = {
  browser: typeof browserDefaultType;
  controllers: HandlerControllers;
  chains: Pick<
    ChainService,
    | "buildProviderMeta"
    | "buildUiNetworksSnapshot"
    | "getActiveChainView"
    | "listAvailableChainsView"
    | "listKnownChainsView"
  >;
  session: BackgroundSessionServices;
  rpcClients: Pick<RpcClientRegistry, "getClient">;
  rpcRegistry: Pick<RpcRegistry, "encodeErrorWithAdapters">;
  persistVaultMeta: () => Promise<void>;
  keyring: KeyringService;
  attention: Pick<AttentionService, "getSnapshot">;
  platform: Pick<UiPlatform, "openOnboardingTab" | "openNotificationPopup">;
};

export const createUiBridge = ({
  browser: runtimeBrowser,
  controllers,
  chains,
  session,
  rpcClients,
  rpcRegistry,
  persistVaultMeta,
  keyring,
  attention,
  platform,
}: BridgeDeps) => {
  const portHub = createUiPortHub();
  const listeners: Array<() => void> = [];

  const uiOrigin = new URL(runtimeBrowser.runtime.getURL("")).origin;

  const dispatcher = createUiDispatcher({
    controllers,
    chains,
    session,
    keyring,
    attention,
    rpcClients,
    rpcRegistry,
    uiOrigin,
    platform,
  });

  let broadcastHold = 0;
  let pendingBroadcast = false;

  const broadcastSnapshotNow = () => {
    portHub.broadcast(dispatcher.buildSnapshotEvent());
  };

  const requestBroadcast = () => {
    if (broadcastHold > 0) {
      pendingBroadcast = true;
      return;
    }
    broadcastSnapshotNow();
  };

  const withBroadcastHold = async <T>(fn: () => Promise<T>): Promise<T> => {
    broadcastHold += 1;
    try {
      return await fn();
    } finally {
      broadcastHold -= 1;
      if (broadcastHold === 0 && pendingBroadcast) {
        pendingBroadcast = false;
        broadcastSnapshotNow();
      }
    }
  };

  const maybeWithHold = async (raw: unknown, fn: () => Promise<void>) => {
    const effects = dispatcher.getRequestEffects(raw);
    if (effects?.holdBroadcast) {
      await withBroadcastHold(fn);
      pendingBroadcast = false;
      return;
    }
    await fn();
  };

  const handleDispatched = async (port: browserDefaultType.Runtime.Port, dispatched: UiDispatchOutput) => {
    const { reply, effects } = dispatched;

    if (reply.type === "ui:response" && effects.persistVaultMeta) {
      try {
        await persistVaultMeta();
      } catch (error) {
        console.warn("[uiBridge] failed to persist vault meta", error);
      }
    }

    // Reply delivery failure (e.g. the requesting port disconnected) must not
    // prevent broadcasting the updated snapshot to other connected UI ports.
    portHub.send(port, reply);

    if (reply.type === "ui:response" && effects.broadcastSnapshot) {
      requestBroadcast();
    }
  };

  const attachPort = (port: browserDefaultType.Runtime.Port) => {
    portHub.attach(port, async (raw) => {
      await maybeWithHold(raw, async () => {
        const dispatched = await dispatcher.dispatch(raw);
        if (!dispatched) return;
        await handleDispatched(port, dispatched);
      });
    });

    portHub.send(port, dispatcher.buildSnapshotEvent());
  };

  const attachListeners = () => {
    listeners.push(
      controllers.accounts.onStateChanged(() => requestBroadcast()),
      controllers.network.onStateChanged(() => requestBroadcast()),
      controllers.approvals.onStateChanged(() => requestBroadcast()),
      controllers.permissions.onPermissionsChanged(() => requestBroadcast()),
      controllers.transactions.onStateChanged(() => requestBroadcast()),
      // Ensure UI stays in sync even when the session lock state changes outside UI-initiated calls.
      session.unlock.onStateChanged(() => requestBroadcast()),
    );
  };

  const teardown = () => {
    listeners.splice(0).forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (error) {
        console.warn("[uiBridge] failed to remove listener", error);
      }
    });

    portHub.teardown();
  };

  return {
    attachPort,
    attachListeners,
    broadcast: requestBroadcast,
    teardown,
  };
};
