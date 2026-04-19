import {
  type ApprovalCreatedEvent,
  type ApprovalTerminalReason,
  getApprovalType,
} from "@arx/core/controllers/approval";
import { createLogger, extendLogger } from "@arx/core/logger";
import type { UiMethodParams, UiMethodResult } from "@arx/core/ui";
import { createUiEntryMetadata, parseUiEntryReason, type UiEntryReason } from "@/lib/uiEntryMetadata";
import { createApprovalWindowTracker } from "../approvals/approvalWindowTracker";
import type { OnboardingOpenResult, UiEntryPlatform } from "../platform/uiPlatform";
import type {
  BackgroundRuntimeHost,
  BackgroundUiEntryAccess,
  BackgroundUnlockAttentionRequestedPayload,
} from "../runtimeHost";

type UiEntryCoordinatorDeps = {
  runtimeHost: BackgroundRuntimeHost;
  platform: UiEntryPlatform;
  onEntryChanged?: (entry: UiEntryLaunchContext) => void;
};

type UiApprovalRecord = ApprovalCreatedEvent["record"];
type UiEntryLaunchContextParams = UiMethodParams<"ui.entry.getLaunchContext">;
type UiEntryLaunchContext = UiMethodResult<"ui.entry.getLaunchContext">;

export type UiEntryCoordinator = {
  start(): void;
  destroy(): void;
  getEntryLaunchContext(params: UiEntryLaunchContextParams): UiEntryLaunchContext;
  openOnboardingTab(reason: string): Promise<OnboardingOpenResult>;
};

const createDefaultEntryLaunchContext = (
  environment: UiEntryLaunchContextParams["environment"],
): UiEntryLaunchContext => {
  switch (environment) {
    case "popup":
      return createUiEntryMetadata({ environment, reason: "manual_open" });
    case "notification":
      return createUiEntryMetadata({ environment, reason: "idle" });
    case "onboarding":
      return createUiEntryMetadata({ environment, reason: "onboarding_required" });
  }
};

const toOnboardingEntryReason = (reason: string): UiEntryReason => {
  const parsed = parseUiEntryReason(reason);
  if (parsed === "install" || parsed === "onboarding_required") {
    return parsed;
  }

  return "onboarding_required";
};

export const createUiEntryCoordinator = ({
  runtimeHost,
  platform,
  onEntryChanged,
}: UiEntryCoordinatorDeps): UiEntryCoordinator => {
  const log = createLogger("bg:ui");
  const entryLog = extendLogger(log, "entries");
  const subscriptions: Array<() => void> = [];
  const trackedWindowIds = new Set<number>();
  const approvalWindowTracker = createApprovalWindowTracker();
  const entryByEnvironment = new Map<UiEntryLaunchContextParams["environment"], UiEntryLaunchContext>();
  let started = false;
  let disposed = false;
  let startTask: Promise<void> | null = null;

  const resetEntries = () => {
    entryByEnvironment.clear();
    entryByEnvironment.set("popup", createDefaultEntryLaunchContext("popup"));
    entryByEnvironment.set("notification", createDefaultEntryLaunchContext("notification"));
    entryByEnvironment.set("onboarding", createDefaultEntryLaunchContext("onboarding"));
  };

  resetEntries();

  const publishEntryChange = (entry: UiEntryLaunchContext) => {
    try {
      onEntryChanged?.(entry);
    } catch (error) {
      entryLog("failed to publish entry change", { entry, error });
    }
  };

  const setEntry = (metadata: UiEntryLaunchContext): UiEntryLaunchContext => {
    const next = createUiEntryMetadata(metadata);
    entryByEnvironment.set(next.environment, next);
    publishEntryChange(next);
    return next;
  };

  const getEntryLaunchContext = ({ environment }: UiEntryLaunchContextParams): UiEntryLaunchContext => {
    return entryByEnvironment.get(environment) ?? createDefaultEntryLaunchContext(environment);
  };

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
          await uiEntryAccess.cancelApproval({ approvalId, reason });
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

    setEntry(
      createUiEntryMetadata({
        environment: "notification",
        reason: request.reason,
        context: {
          origin: request.origin,
          method: request.method,
          chainRef: request.chainRef,
          namespace: request.namespace,
        },
      }),
    );

    void platform
      .openNotificationPopup({
        reason: request.reason,
        origin: request.origin,
        method: request.method,
        chainRef: request.chainRef,
        namespace: request.namespace,
      })
      .then(async (result) => {
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

    setEntry(
      createUiEntryMetadata({
        environment: "notification",
        reason: "approval_created",
        context: {
          approvalId: record.approvalId,
          origin: record.origin,
          method,
          chainRef: record.chainRef,
          namespace: record.namespace,
        },
      }),
    );

    void platform
      .openNotificationPopup({
        reason: "approval_created",
        origin: record.origin,
        method,
        chainRef: record.chainRef,
        namespace: record.namespace,
      })
      .then(async (result) => {
        if (disposed || !result.windowId) {
          return;
        }

        ensureWindowTracked(uiEntryAccess, result.windowId);
        approvalWindowTracker.assign({ windowId: result.windowId, approvalId: record.approvalId });
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

  const openOnboardingTab = async (reason: string) => {
    setEntry(
      createUiEntryMetadata({
        environment: "onboarding",
        reason: toOnboardingEntryReason(reason),
      }),
    );

    return await platform.openOnboardingTab(reason);
  };

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
          uiEntryAccess.subscribeApprovalFinished(({ approvalId }) => {
            approvalWindowTracker.deleteApproval(approvalId);
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
    resetEntries();
  };

  return {
    start,
    destroy,
    getEntryLaunchContext,
    openOnboardingTab,
  };
};
