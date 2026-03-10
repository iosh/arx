import {
  type ApprovalTerminalReason,
  ATTENTION_REQUESTED,
  createLogger,
  extendLogger,
  getApprovalType,
} from "@arx/core";
import { createApprovalWindowTracker } from "../approvals/approvalWindowTracker";
import type { UiPlatform } from "../platform/uiPlatform";
import type { BackgroundRuntimeHost } from "../runtimeHost";

type ApprovalUiOrchestratorDeps = {
  runtimeHost: BackgroundRuntimeHost;
  platform: UiPlatform;
};

type AttentionRequestedPayload = {
  reason: string;
  origin?: string;
  method?: string;
  chainRef?: string | null;
  namespace?: string | null;
};

export const createApprovalUiListener = ({ runtimeHost, platform }: ApprovalUiOrchestratorDeps) => {
  const log = createLogger("bg:listener");
  const popupLog = extendLogger(log, "notification");
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

  const start = () => {
    if (started) return;
    started = true;
    disposed = false;

    if (startTask) return;

    startTask = (async () => {
      const { runtime, controllers, session } = await runtimeHost.getOrInitContext();
      if (disposed) return;

      const cancelApprovalIds = async (approvalIds: string[], reason: ApprovalTerminalReason) => {
        await Promise.all(
          approvalIds.map(async (approvalId) => {
            try {
              await controllers.approvals.cancel({ id: approvalId, reason });
            } catch (error) {
              popupLog("failed to cancel approval", { approvalId, reason, error });
            }
          }),
        );
      };

      const cancelPendingApprovals = async (reason: ApprovalTerminalReason) => {
        const approvalIds = controllers.approvals.getState().pending.map((item) => item.id);
        await cancelApprovalIds(approvalIds, reason);
      };

      const ensureWindowTracked = (windowId: number) => {
        if (trackedWindowIds.has(windowId)) {
          return;
        }

        trackedWindowIds.add(windowId);
        platform.trackWindowClose(windowId, () => {
          trackedWindowIds.delete(windowId);
          const approvalIds = approvalWindowTracker.takeWindowApprovalIds(windowId);
          void cancelApprovalIds(approvalIds, "window_closed");
        });
      };

      subscriptions.push(
        runtime.bus.subscribe(ATTENTION_REQUESTED, (request: AttentionRequestedPayload) => {
          popupLog("event:attention:requested", {
            reason: request.reason,
            origin: request.origin,
            method: request.method,
            chainRef: request.chainRef,
            namespace: request.namespace,
          });

          if (request.reason !== "unlock_required") {
            return;
          }

          const vaultInitialized = session.vault.getStatus().hasEnvelope;
          if (!vaultInitialized) {
            popupLog("skip notification window (vault uninitialized)", {
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
              if (disposed) return;
              if (!result.windowId) return;
              ensureWindowTracked(result.windowId);
            })
            .catch((error) => {
              popupLog("failed to open notification window", {
                error,
                reason: request.reason,
                origin: request.origin,
                method: request.method,
                chainRef: request.chainRef,
                namespace: request.namespace,
              });
            });
        }),
      );

      subscriptions.push(
        controllers.approvals.onCreated(({ record }) => {
          if (record.requester.transport !== "provider") {
            return;
          }

          const method = getApprovalType(record.kind);
          const vaultInitialized = session.vault.getStatus().hasEnvelope;
          if (!vaultInitialized) {
            popupLog("skip notification window (vault uninitialized)", {
              reason: "approval_required",
              origin: record.origin,
              method,
              chainRef: record.chainRef,
              namespace: record.namespace,
            });
            return;
          }

          void platform
            .openNotificationPopup({
              reason: "approval_required",
              origin: record.origin,
              method,
              chainRef: record.chainRef,
              namespace: record.namespace,
              urlSearchParams: { approvalId: record.id },
            })
            .then((result) => {
              if (disposed) return;
              if (!result.windowId) return;
              ensureWindowTracked(result.windowId);
              approvalWindowTracker.assign({ windowId: result.windowId, approvalId: record.id });
            })
            .catch((error) => {
              popupLog("failed to open notification window", {
                error,
                reason: "approval_required",
                origin: record.origin,
                method,
                chainRef: record.chainRef,
                namespace: record.namespace,
              });
            });
        }),
      );

      subscriptions.push(
        controllers.approvals.onFinished(({ id }) => {
          approvalWindowTracker.deleteApproval(id);
        }),
      );

      subscriptions.push(
        session.unlock.onLocked(() => {
          void cancelPendingApprovals("locked");
        }),
      );

      subscriptions.push(
        controllers.approvals.onStateChanged(() => {
          const pending = controllers.approvals.getState().pending;
          if (pending.length === 0) {
            clearWindowTracking();
          }
        }),
      );

      subscriptions.push(
        session.unlock.onStateChanged(() => {
          if (session.unlock.isUnlocked()) return;
          clearWindowTracking();
        }),
      );
    })().finally(() => {
      startTask = null;
    });
  };

  const destroy = () => {
    started = false;
    disposed = true;
    subscriptions.splice(0).forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch {
        // best-effort
      }
    });
    clearWindowTracking();
  };

  return { start, destroy };
};
