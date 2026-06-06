import { type ApprovalTerminalReason, getApprovalType } from "@arx/core/approvals";
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

type UiEntryLaunchContextParams = UiMethodParams<"ui.entry.getLaunchContext">;
type UiEntryLaunchContext = UiMethodResult<"ui.entry.getLaunchContext">;
type UiEntryBootstrap = UiMethodResult<"ui.entry.getBootstrap">;
type UiApprovalEntry = Parameters<BackgroundUiEntryAccess["subscribeApprovalCreated"]>[0] extends (
  event: infer Event,
) => void
  ? Event extends { approval: infer Approval }
    ? Approval
    : never
  : never;

export type UiEntryCoordinator = {
  start(): void;
  destroy(): void;
  getEntryLaunchContext(params: UiEntryLaunchContextParams): UiEntryLaunchContext;
  getEntryBootstrap(params: UiEntryLaunchContextParams): Promise<UiEntryBootstrap>;
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

  const getEntryBootstrap = async ({ environment }: UiEntryLaunchContextParams): Promise<UiEntryBootstrap> => {
    const entry = getEntryLaunchContext({ environment });
    const approvalId = entry.reason === "approval_created" ? entry.context.approvalId : null;

    if (!approvalId) {
      return {
        entry,
        requestedApproval: null,
      };
    }

    const uiEntryAccess = await runtimeHost.getOrInitUiEntryAccess();
    const initialDetail = await uiEntryAccess.getApprovalDetail(approvalId);

    if (!initialDetail) {
      return {
        entry,
        requestedApproval: null,
      };
    }

    return {
      entry,
      requestedApproval: {
        approvalId,
        initialDetail,
      },
    };
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
      void cancelApprovalIds(uiEntryAccess, approvalIds, "user_dismissed");
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

  const openNotificationForApproval = (uiEntryAccess: BackgroundUiEntryAccess, approval: UiApprovalEntry) => {
    if (approval.requester.initiator !== "dapp") {
      return;
    }

    const method = getApprovalType(approval.kind);
    if (!uiEntryAccess.hasInitializedVault()) {
      entryLog("skip notification window (vault uninitialized)", {
        reason: "approval_created",
        origin: approval.origin,
        method,
        chainRef: approval.chainRef,
        namespace: approval.namespace,
      });
      return;
    }

    setEntry(
      createUiEntryMetadata({
        environment: "notification",
        reason: "approval_created",
        context: {
          approvalId: approval.approvalId,
          origin: approval.origin,
          method,
          chainRef: approval.chainRef,
          namespace: approval.namespace,
        },
      }),
    );

    void platform
      .openNotificationPopup({
        reason: "approval_created",
        origin: approval.origin,
        method,
        chainRef: approval.chainRef,
        namespace: approval.namespace,
      })
      .then(async (result) => {
        if (disposed || !result.windowId) {
          return;
        }

        ensureWindowTracked(uiEntryAccess, result.windowId);
        approvalWindowTracker.assign({ windowId: result.windowId, approvalId: approval.approvalId });
      })
      .catch((error) => {
        entryLog("failed to open notification window", {
          error,
          reason: "approval_created",
          origin: approval.origin,
          method,
          chainRef: approval.chainRef,
          namespace: approval.namespace,
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
          uiEntryAccess.subscribeApprovalCreated(({ approval }) => {
            openNotificationForApproval(uiEntryAccess, approval);
          }),
        );
        subscriptions.push(
          uiEntryAccess.subscribeApprovalFinished(({ approvalId }) => {
            approvalWindowTracker.deleteApproval(approvalId);
          }),
        );
        subscriptions.push(
          uiEntryAccess.subscribeApprovalStateChanged(() => {
            void uiEntryAccess
              .getPendingApprovalCount()
              .then((pendingApprovalCount) => {
                if (pendingApprovalCount === 0) {
                  clearWindowTracking();
                }
              })
              .catch((error) => {
                entryLog("failed to read pending approval count", error);
              });
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
    getEntryBootstrap,
    openOnboardingTab,
  };
};
