import {
  ArxReasons,
  type AttentionService,
  arxError,
  type BackgroundSessionServices,
  type HandlerControllers,
  type KeyringService,
} from "@arx/core";
import { isUiMethodName, type UiRequestEnvelope, uiMethods } from "@arx/core/ui";
import { createUiDispatcher, type UiDispatchOutput } from "@arx/core/ui/runtime";

import type browserDefaultType from "webextension-polyfill";
import { ENTRYPOINTS } from "./constants";
import { createPopupActivator } from "./services/popupActivator";
import { createUiPortHub } from "./ui/portHub";

export { UI_CHANNEL } from "@arx/core/ui";

type BridgeDeps = {
  browser: typeof browserDefaultType;
  controllers: HandlerControllers;
  session: BackgroundSessionServices;
  persistVaultMeta: () => Promise<void>;
  keyring: KeyringService;
  attention: Pick<AttentionService, "getSnapshot">;
};

export const createUiBridge = ({
  browser: runtimeBrowser,
  controllers,
  session,
  persistVaultMeta,
  keyring,
  attention,
}: BridgeDeps) => {
  const portHub = createUiPortHub();
  const listeners: Array<() => void> = [];

  const onboardingCooldownMs = 500;
  let lastOnboardingAttemptAt: number | null = null;
  let onboardingInFlight: Promise<{ activationPath: "focus" | "create" | "debounced"; tabId?: number }> | null = null;
  let cachedOnboardingTabId: number | null = null;

  const openOnboardingTab = (_reason: string) => {
    if (onboardingInFlight) return onboardingInFlight;

    const promise = (async () => {
      const now = Date.now();

      if (lastOnboardingAttemptAt !== null && now - lastOnboardingAttemptAt < onboardingCooldownMs) {
        return cachedOnboardingTabId
          ? { activationPath: "debounced" as const, tabId: cachedOnboardingTabId }
          : { activationPath: "debounced" as const };
      }
      lastOnboardingAttemptAt = now;

      const onboardingBaseUrl = runtimeBrowser.runtime.getURL(ENTRYPOINTS.ONBOARDING);
      const onboardingTargetUrl = onboardingBaseUrl;

      let existingTabs: browserDefaultType.Tabs.Tab[] = [];
      try {
        existingTabs = await runtimeBrowser.tabs.query({ url: [`${onboardingBaseUrl}*`] });
      } catch {
        const allTabs = await runtimeBrowser.tabs.query({});
        existingTabs = (allTabs ?? []).filter(
          (tab) => typeof tab.url === "string" && tab.url.startsWith(onboardingBaseUrl),
        );
      }

      const existing = existingTabs.find((tab) => typeof tab.id === "number");
      if (existing?.id) {
        cachedOnboardingTabId = existing.id;
        await runtimeBrowser.tabs.update(existing.id, { active: true });
        if (typeof existing.windowId === "number") {
          await runtimeBrowser.windows.update(existing.windowId, { focused: true });
        }
        return { activationPath: "focus" as const, tabId: existing.id };
      }

      const created = await runtimeBrowser.tabs.create({ url: onboardingTargetUrl, active: true });
      if (typeof created.windowId === "number") {
        await runtimeBrowser.windows.update(created.windowId, { focused: true });
      }
      cachedOnboardingTabId = typeof created.id === "number" ? created.id : null;
      return typeof created.id === "number"
        ? { activationPath: "create" as const, tabId: created.id }
        : { activationPath: "create" as const };
    })().finally(() => {
      onboardingInFlight = null;
    });

    onboardingInFlight = promise;
    return promise;
  };

  const notificationActivator = createPopupActivator({ browser: runtimeBrowser, popupPath: ENTRYPOINTS.NOTIFICATION });

  /**
   * Reject all pending approvals with a 4001 userRejectedRequest error.
   * Used when the confirmation window is closed to prevent hanging dApp requests.
   */
  const rejectAllPendingApprovals = (reason: string, details?: Record<string, unknown>) => {
    const pending = controllers.approvals.getState().pending;
    if (pending.length === 0) return;

    const snapshot = [...pending];
    for (const item of snapshot) {
      controllers.approvals.reject(
        item.id,
        arxError({
          reason: ArxReasons.ApprovalRejected,
          message: "User rejected the request.",
          data: { reason, id: item.id, origin: item.origin, type: item.type, ...details },
        }),
      );
    }
  };

  const trackedPopupWindows = new Map<number, (removedId: number) => void>();
  const attachPopupCloseRejection = (windowId: number) => {
    if (trackedPopupWindows.has(windowId)) return;

    const onRemoved = (removedId: number) => {
      if (removedId !== windowId) return;
      runtimeBrowser.windows.onRemoved.removeListener(onRemoved);
      trackedPopupWindows.delete(windowId);
      rejectAllPendingApprovals("windowClosed", { windowId });
    };

    trackedPopupWindows.set(windowId, onRemoved);
    runtimeBrowser.windows.onRemoved.addListener(onRemoved);
  };

  const openNotificationPopup = async () => {
    const result = await notificationActivator.open();
    if (result.windowId) attachPopupCloseRejection(result.windowId);
    return result;
  };

  const uiOrigin = new URL(runtimeBrowser.runtime.getURL("")).origin;

  const dispatcher = createUiDispatcher({
    controllers,
    session,
    keyring,
    attention,
    uiOrigin,
    platform: { openOnboardingTab, openNotificationPopup },
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
    const envelope = raw as Partial<UiRequestEnvelope> | null;
    const shouldHold =
      envelope?.type === "ui:request" &&
      typeof envelope.method === "string" &&
      isUiMethodName(envelope.method) &&
      uiMethods[envelope.method].effects?.holdBroadcast === true;

    if (shouldHold) {
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

    for (const listener of trackedPopupWindows.values()) {
      runtimeBrowser.windows.onRemoved.removeListener(listener);
    }
    trackedPopupWindows.clear();

    portHub.teardown();
  };

  return {
    attachPort,
    attachListeners,
    broadcast: requestBroadcast,
    teardown,
  };
};
