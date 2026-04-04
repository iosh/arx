import { type ApprovalTerminalReason, getApprovalType } from "@arx/core/controllers/approval";
import { createLogger, extendLogger } from "@arx/core/logger";
import { createApprovalWindowTracker } from "../approvals/approvalWindowTracker";
import type { UiPlatform } from "../platform/uiPlatform";
import type { BackgroundRuntimeHost, BackgroundUnlockAttentionRequestedPayload } from "../runtimeHost";

type ApprovalUiOrchestratorDeps = {
  runtimeHost: BackgroundRuntimeHost;
  platform: UiPlatform;
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

  const start = () => {
    if (started || startTask) return;
    disposed = false;

    startTask = (async () => {
      try {
        const approvalPopupAccess = await runtimeHost.getOrInitApprovalPopupAccess();
        if (disposed) return;

        const cancelApprovalIds = async (approvalIds: string[], reason: ApprovalTerminalReason) => {
          await Promise.all(
            approvalIds.map(async (approvalId) => {
              try {
                await approvalPopupAccess.cancelApproval({ id: approvalId, reason });
              } catch (error) {
                popupLog("failed to cancel approval", { approvalId, reason, error });
              }
            }),
          );
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
          approvalPopupAccess.subscribeUnlockAttentionRequested(
            (request: BackgroundUnlockAttentionRequestedPayload) => {
              popupLog("event:attention:requested", {
                reason: request.reason,
                origin: request.origin,
                method: request.method,
                chainRef: request.chainRef,
                namespace: request.namespace,
              });

              const vaultInitialized = approvalPopupAccess.hasInitializedVault();
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
            },
          ),
        );

        subscriptions.push(
          approvalPopupAccess.subscribeApprovalCreated(({ record }) => {
            if (record.requester.transport !== "provider") {
              return;
            }

            const method = getApprovalType(record.kind);
            const vaultInitialized = approvalPopupAccess.hasInitializedVault();
            if (!vaultInitialized) {
              popupLog("skip notification window (vault uninitialized)", {
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
                if (disposed) return;
                if (!result.windowId) return;
                ensureWindowTracked(result.windowId);
                approvalWindowTracker.assign({ windowId: result.windowId, approvalId: record.id });
              })
              .catch((error) => {
                popupLog("failed to open notification window", {
                  error,
                  reason: "approval_created",
                  origin: record.origin,
                  method,
                  chainRef: record.chainRef,
                  namespace: record.namespace,
                });
              });
          }),
        );

        subscriptions.push(
          approvalPopupAccess.subscribeApprovalFinished(({ id }) => {
            approvalWindowTracker.deleteApproval(id);
          }),
        );

        subscriptions.push(
          approvalPopupAccess.subscribeApprovalStateChanged(() => {
            if (approvalPopupAccess.getPendingApprovalCount() === 0) {
              clearWindowTracking();
            }
          }),
        );

        started = true;
      } catch (error) {
        clearSubscriptions();
        clearWindowTracking();
        popupLog("failed to start approval ui listener", error);
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

  return { start, destroy };
};
