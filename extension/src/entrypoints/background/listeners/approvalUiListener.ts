import { ATTENTION_REQUESTED, createLogger, extendLogger, getApprovalType } from "@arx/core";
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
                  reason: "window_closed",
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
              chainRef: record.chainRef ?? null,
              namespace: record.namespace ?? null,
              urlSearchParams: { approvalId: record.id },
            })
            .then((result) => {
              if (disposed) return;
              if (!result.windowId) return;
              platform.trackWindowClose(result.windowId, () => {
                void rejectPendingApprovals(controllers, {
                  reason: "window_closed",
                  details: { windowId: result.windowId },
                });
              });
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
        session.unlock.onLocked((payload) => {
          void rejectPendingApprovals(controllers, {
            reason: "locked",
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
