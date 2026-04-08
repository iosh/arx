import {
  type ApprovalCreatedEvent,
  type ApprovalTerminalReason,
  getApprovalType,
} from "@arx/core/controllers/approval";
import { createLogger, extendLogger } from "@arx/core/logger";
import { createApprovalWindowTracker } from "../approvals/approvalWindowTracker";
import type { OnboardingOpenResult, UiEntryPlatform } from "../platform/uiPlatform";
import type {
  BackgroundRuntimeHost,
  BackgroundUiEntryAccess,
  BackgroundUnlockAttentionRequestedPayload,
} from "../runtimeHost";
import type { PopupOpenResult } from "../services/popupActivator";

type UiEntryCoordinatorDeps = {
  runtimeHost: BackgroundRuntimeHost;
  platform: UiEntryPlatform;
};

type UiApprovalRecord = ApprovalCreatedEvent["record"];

export type UiEntryCoordinator = {
  start(): void;
  destroy(): void;
  openOnboardingTab(reason: string): Promise<OnboardingOpenResult>;
  openNotificationPopup(): Promise<PopupOpenResult>;
};

export const createUiEntryCoordinator = ({ runtimeHost, platform }: UiEntryCoordinatorDeps): UiEntryCoordinator => {
  const log = createLogger("bg:ui");
  const entryLog = extendLogger(log, "entries");
  const subscriptions: Array<() => void> = [];
  const trackedWindowIds = new Set<number>();
  const approvalWindowTracker = createApprovalWindowTracker();
  let started = false;
  let disposed = false;
  let startTask: Promise<void> | null = null;

  const clearWindowTracking = () => {
    trackedWindowIds.clear();
    approvalWindowTracker.clear();
    platform.clearWindowCloseTracks();
  };

  const clearSubscriptions = () => {
    const activeSubscriptions = [...subscriptions];
    subscriptions.length = 0;

    for (const unsubscribe of activeSubscriptions) {
      try {
        unsubscribe();
      } catch {
        // best-effort
      }
    }
  };

  const cancelApprovalIds = async (
    uiEntryAccess: BackgroundUiEntryAccess,
    approvalIds: string[],
    reason: ApprovalTerminalReason,
  ) => {
    await Promise.all(
      approvalIds.map(async (approvalId) => {
        try {
          await uiEntryAccess.cancelApproval({ id: approvalId, reason });
        } catch (error) {
          entryLog("failed to cancel approval", { approvalId, reason, error });
        }
      }),
    );
  };

  const ensureWindowTracked = (uiEntryAccess: BackgroundUiEntryAccess, windowId: number) => {
    if (trackedWindowIds.has(windowId)) {
      return;
    }

    trackedWindowIds.add(windowId);
    platform.trackWindowClose(windowId, () => {
      trackedWindowIds.delete(windowId);
      const approvalIds = approvalWindowTracker.takeWindowApprovalIds(windowId);
      void cancelApprovalIds(uiEntryAccess, approvalIds, "window_closed");
    });
  };

  const openNotificationForUnlockAttention = (
    uiEntryAccess: BackgroundUiEntryAccess,
    request: BackgroundUnlockAttentionRequestedPayload,
  ) => {
    entryLog("event:attention:requested", {
      reason: request.reason,
      origin: request.origin,
      method: request.method,
      chainRef: request.chainRef,
      namespace: request.namespace,
    });

    if (!uiEntryAccess.hasInitializedVault()) {
      entryLog("skip notification window (vault uninitialized)", {
        reason: request.reason,
        origin: request.origin,
        method: request.method,
        chainRef: request.chainRef,
        namespace: request.namespace,
      });
      return;
    }

    void platform
      .openNotificationPopup({
        reason: request.reason,
        origin: request.origin,
        method: request.method,
        chainRef: request.chainRef,
        namespace: request.namespace,
      })
      .then((result) => {
        if (disposed || !result.windowId) {
          return;
        }

        ensureWindowTracked(uiEntryAccess, result.windowId);
      })
      .catch((error) => {
        entryLog("failed to open notification window", {
          error,
          reason: request.reason,
          origin: request.origin,
          method: request.method,
          chainRef: request.chainRef,
          namespace: request.namespace,
        });
      });
  };

  const openNotificationForApproval = (uiEntryAccess: BackgroundUiEntryAccess, record: UiApprovalRecord) => {
    if (record.requester.transport !== "provider") {
      return;
    }

    const method = getApprovalType(record.kind);
    if (!uiEntryAccess.hasInitializedVault()) {
      entryLog("skip notification window (vault uninitialized)", {
        reason: "approval_created",
        origin: record.origin,
        method,
        chainRef: record.chainRef,
        namespace: record.namespace,
      });
      return;
    }

    void platform
      .openNotificationPopup({
        reason: "approval_created",
        origin: record.origin,
        method,
        chainRef: record.chainRef,
        namespace: record.namespace,
        urlSearchParams: { approvalId: record.id },
      })
      .then((result) => {
        if (disposed || !result.windowId) {
          return;
        }

        ensureWindowTracked(uiEntryAccess, result.windowId);
        approvalWindowTracker.assign({ windowId: result.windowId, approvalId: record.id });
      })
      .catch((error) => {
        entryLog("failed to open notification window", {
          error,
          reason: "approval_created",
          origin: record.origin,
          method,
          chainRef: record.chainRef,
          namespace: record.namespace,
        });
      });
  };

  const openOnboardingTab = async (reason: string) => await platform.openOnboardingTab(reason);

  const openNotificationPopup = async () => await platform.openNotificationPopup();

  const start = () => {
    if (started || startTask) {
      return;
    }

    disposed = false;
    startTask = (async () => {
      try {
        const uiEntryAccess = await runtimeHost.getOrInitUiEntryAccess();
        if (disposed) {
          return;
        }

        subscriptions.push(
          uiEntryAccess.subscribeUnlockAttentionRequested((request) => {
            openNotificationForUnlockAttention(uiEntryAccess, request);
          }),
        );
        subscriptions.push(
          uiEntryAccess.subscribeApprovalCreated(({ record }) => {
            openNotificationForApproval(uiEntryAccess, record);
          }),
        );
        subscriptions.push(
          uiEntryAccess.subscribeApprovalFinished(({ id }) => {
            approvalWindowTracker.deleteApproval(id);
          }),
        );
        subscriptions.push(
          uiEntryAccess.subscribeApprovalStateChanged(() => {
            if (uiEntryAccess.getPendingApprovalCount() === 0) {
              clearWindowTracking();
            }
          }),
        );

        started = true;
      } catch (error) {
        clearSubscriptions();
        clearWindowTracking();
        entryLog("failed to start ui entry coordinator", error);
      }
    })().finally(() => {
      startTask = null;
    });
  };

  const destroy = () => {
    started = false;
    disposed = true;
    clearSubscriptions();
    clearWindowTracking();
  };

  return {
    start,
    destroy,
    openOnboardingTab,
    openNotificationPopup,
  };
};
