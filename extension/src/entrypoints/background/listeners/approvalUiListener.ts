import { ATTENTION_REQUESTED, createLogger, extendLogger } from "@arx/core";
import { rejectPendingApprovals } from "../approvals/rejectPendingApprovals";
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
  let started = false;
  let disposed = false;
  let startTask: Promise<void> | null = null;

  const start = () => {
    if (started) return;
    started = true;
    disposed = false;

    if (startTask) return;

    startTask = (async () => {
      const { runtime, controllers, session } = await runtimeHost.getOrInitContext();
      if (disposed) return;

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
              platform.trackWindowClose(result.windowId, () => {
                void rejectPendingApprovals(controllers, {
                  reason: "windowClosed",
                  details: { windowId: result.windowId },
                });
              });
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
        controllers.approvals.onRequest(({ task, requestContext }) => {
          if (requestContext.transport !== "provider") {
            return;
          }

          const vaultInitialized = session.vault.getStatus().hasEnvelope;
          if (!vaultInitialized) {
            popupLog("skip notification window (vault uninitialized)", {
              reason: "approval_required",
              origin: task.origin,
              method: task.type,
              chainRef: task.chainRef,
              namespace: task.namespace,
            });
            return;
          }

          void platform
            .openNotificationPopup({
              reason: "approval_required",
              origin: task.origin,
              method: task.type,
              chainRef: task.chainRef ?? null,
              namespace: task.namespace ?? null,
              urlSearchParams: { approvalId: task.id },
            })
            .then((result) => {
              if (disposed) return;
              if (!result.windowId) return;
              platform.trackWindowClose(result.windowId, () => {
                void rejectPendingApprovals(controllers, {
                  reason: "windowClosed",
                  details: { windowId: result.windowId },
                });
              });
            })
            .catch((error) => {
              popupLog("failed to open notification window", {
                error,
                reason: "approval_required",
                origin: task.origin,
                method: task.type,
                chainRef: task.chainRef,
                namespace: task.namespace,
              });
            });
        }),
      );

      subscriptions.push(
        session.unlock.onLocked((payload) => {
          void rejectPendingApprovals(controllers, {
            reason: "sessionLocked",
            details: { lockReason: payload.reason },
          });
        }),
      );

      subscriptions.push(
        controllers.approvals.onStateChanged(() => {
          const pending = controllers.approvals.getState().pending;
          if (pending.length === 0) {
            platform.clearWindowCloseTracks();
          }
        }),
      );

      subscriptions.push(
        session.unlock.onStateChanged(() => {
          if (session.unlock.isUnlocked()) return;
          platform.clearWindowCloseTracks();
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
    platform.clearWindowCloseTracks();
  };

  return { start, destroy };
};
