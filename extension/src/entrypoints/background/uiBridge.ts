import type { AccountCodecRegistry } from "@arx/core/accounts";
import { createLogger, extendLogger } from "@arx/core/logger";
import type { NamespaceRuntimeBindingsRegistry } from "@arx/core/namespaces";
import type { HandlerControllers, RpcRegistry } from "@arx/core/rpc";
import type { BackgroundSessionServices, KeyringService } from "@arx/core/runtime";
import type {
  AttentionService,
  ChainActivationService,
  ChainViewsService,
  NetworkPreferencesService,
  PermissionViewsService,
} from "@arx/core/services";
import { UI_EVENT_SNAPSHOT_CHANGED } from "@arx/core/ui";
import {
  createUiDispatcher,
  createUiServerRuntime,
  getUiRequestEffects,
  type UiDispatchOutput,
} from "@arx/core/ui/server";

import type browserDefaultType from "webextension-polyfill";
import type { UiPlatform } from "./platform/uiPlatform";
import { createUiPortHub } from "./ui/portHub";
import { createUiSnapshotBroadcaster } from "./ui/snapshotBroadcaster";

export { UI_CHANNEL } from "@arx/core/ui";

const uiLog = createLogger("bg:ui");
const bridgeLog = extendLogger(uiLog, "bridge");

type BridgeDeps = {
  browser: typeof browserDefaultType;
  controllers: HandlerControllers;
  chainActivation: Pick<ChainActivationService, "selectWalletChain">;
  chainViews: Pick<
    ChainViewsService,
    | "buildProviderMeta"
    | "buildWalletNetworksSnapshot"
    | "findAvailableChainView"
    | "getApprovalReviewChainView"
    | "getPreferredChainViewForNamespace"
    | "getProviderChainView"
    | "getSelectedChainView"
    | "listAvailableChainViews"
    | "listKnownChainViews"
    | "requireAvailableChainMetadata"
  >;
  permissionViews: Pick<PermissionViewsService, "buildUiPermissionsSnapshot">;
  networkPreferences: Pick<NetworkPreferencesService, "subscribeChanged">;
  accountCodecs: Pick<AccountCodecRegistry, "get" | "toAccountIdFromAddress">;
  session: BackgroundSessionServices;
  namespaceBindings: Pick<NamespaceRuntimeBindingsRegistry, "getUi" | "hasTransaction">;
  rpcRegistry: Pick<RpcRegistry, "encodeErrorWithAdapters">;
  persistVaultMeta: () => Promise<void>;
  keyring: KeyringService;
  attention: Pick<AttentionService, "getSnapshot">;
  platform: Pick<UiPlatform, "openOnboardingTab" | "openNotificationPopup">;
};

export const createUiBridge = ({
  browser: runtimeBrowser,
  controllers,
  chainActivation,
  chainViews,
  permissionViews,
  networkPreferences,
  accountCodecs,
  session,
  namespaceBindings,
  rpcRegistry,
  persistVaultMeta,
  keyring,
  attention,
  platform,
}: BridgeDeps) => {
  const portHub = createUiPortHub();
  const listeners: Array<() => void> = [];

  const uiOrigin = new URL(runtimeBrowser.runtime.getURL("")).origin;

  const uiRuntime = createUiServerRuntime({
    controllers,
    chainActivation,
    chainViews,
    permissionViews,
    accountCodecs,
    session,
    keyring,
    attention,
    namespaceBindings,
    rpcRegistry,
    platform,
    uiOrigin,
  });
  const dispatcher = createUiDispatcher({
    handlers: uiRuntime.handlers,
    getUiContext: uiRuntime.getUiContext,
    rpcRegistry,
  });

  const buildSnapshotEventSafely = () => {
    try {
      return {
        type: "ui:event" as const,
        event: UI_EVENT_SNAPSHOT_CHANGED,
        payload: uiRuntime.buildSnapshot(),
        context: uiRuntime.getUiContext(),
      };
    } catch (error) {
      bridgeLog("failed to build snapshot", error);
      return null;
    }
  };

  const snapshotBroadcaster = createUiSnapshotBroadcaster({
    portHub,
    buildSnapshotEvent: buildSnapshotEventSafely,
  });

  const maybeWithHold = async (raw: unknown, fn: () => Promise<void>) => {
    const effects = getUiRequestEffects(raw);
    if (effects?.holdBroadcast) {
      await snapshotBroadcaster.withBroadcastHold(fn);
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
        bridgeLog("failed to persist vault meta", error);
      }
    }

    portHub.send(port, reply);

    if (reply.type === "ui:response" && effects.broadcastSnapshot) {
      snapshotBroadcaster.requestBroadcast();
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

    snapshotBroadcaster.sendInitialSnapshot(port);
  };

  const attachListeners = () => {
    listeners.push(
      controllers.accounts.onStateChanged(() => snapshotBroadcaster.requestBroadcast()),
      controllers.network.onStateChanged(() => snapshotBroadcaster.requestBroadcast()),
      controllers.approvals.onStateChanged(() => snapshotBroadcaster.requestBroadcast()),
      controllers.permissions.onStateChanged(() => snapshotBroadcaster.requestBroadcast()),
      controllers.transactions.onStateChanged(() => snapshotBroadcaster.requestBroadcast()),
      networkPreferences.subscribeChanged(() => snapshotBroadcaster.requestBroadcast()),
      session.unlock.onStateChanged(() => snapshotBroadcaster.requestBroadcast()),
    );
  };

  const teardown = () => {
    listeners.splice(0).forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (error) {
        bridgeLog("failed to remove listener", error);
      }
    });

    portHub.teardown();
  };

  return {
    attachPort,
    attachListeners,
    broadcast: snapshotBroadcaster.requestBroadcast,
    teardown,
  };
};
