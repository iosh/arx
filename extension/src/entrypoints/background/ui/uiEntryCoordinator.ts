import { getApprovalType } from "@arx/core/approvals";
import type { ApprovalListEntry } from "@arx/core/wallet";
import type { HostMethods, UiEntryBootstrap, UiEntryLaunchContext } from "@/lib/host";
import { createUiEntryMetadata, parseUiEntryReason, type UiEntryReason } from "@/lib/uiEntryMetadata";
import { createApprovalWindowTracker } from "../approvals/approvalWindowTracker";
import type { OnboardingOpenResult, UiEntryPlatform } from "../platform/uiPlatform";
import type { BackgroundUiEntryAccess, BackgroundUnlockAttentionRequestedPayload } from "../runtimeHost";

type BackgroundUiEntryAccessOwner = {
  getOrInitUiEntryAccess: () => Promise<BackgroundUiEntryAccess>;
};

type UiEntryCoordinatorDeps = {
  runtimeHost: BackgroundUiEntryAccessOwner;
  platform: UiEntryPlatform;
  onEntryChanged?: (entry: UiEntryLaunchContext) => void;
};

type UiEntryLaunchContextParams = Parameters<HostMethods["getEntryLaunchContext"]>[0];
export type UiEntryCoordinator = {
  start(): Promise<void>;
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

const LOG_PREFIX = "[arx:bg:ui:entries]";

export const createUiEntryCoordinator = ({
  runtimeHost,
  platform,
  onEntryChanged,
}: UiEntryCoordinatorDeps): UiEntryCoordinator => {
  const subscriptions: Array<() => void> = [];
  const trackedWindowIds = new Set<number>();
  const approvalWindowTracker = createApprovalWindowTracker();
  const seenProviderApprovalIds = new Set<string>();
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
    } catch {
      // UI entry broadcasts are opportunistic; attached views will re-read bootstrap state.
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
    seenProviderApprovalIds.clear();
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

  const dismissApprovalIds = async (uiEntryAccess: BackgroundUiEntryAccess, approvalIds: readonly string[]) => {
    await Promise.all(
      approvalIds.map(async (approvalId) => {
        try {
          await uiEntryAccess.dismissApproval({ approvalId });
        } catch {
          // Window-close dismissal is best-effort; the approval queue remains the source of truth.
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
      void dismissApprovalIds(uiEntryAccess, approvalIds);
    });
  };

  const hasInitializedVault = async (uiEntryAccess: BackgroundUiEntryAccess) => {
    const sessionStatus = await uiEntryAccess.getSessionStatus();
    return sessionStatus.vaultInitialized;
  };

  const openNotificationForUnlockAttention = (
    uiEntryAccess: BackgroundUiEntryAccess,
    request: BackgroundUnlockAttentionRequestedPayload,
  ) => {
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
        console.warn(LOG_PREFIX, "failed to open notification window", {
          error,
          reason: request.reason,
          origin: request.origin,
          method: request.method,
          chainRef: request.chainRef,
          namespace: request.namespace,
        });
      });
  };

  const openNotificationForApproval = (uiEntryAccess: BackgroundUiEntryAccess, approval: ApprovalListEntry) => {
    if (approval.source !== "provider") {
      return;
    }

    const method = getApprovalType(approval.kind);

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
        console.warn(LOG_PREFIX, "failed to open notification window", {
          error,
          reason: "approval_created",
          origin: approval.origin,
          method,
          chainRef: approval.chainRef,
          namespace: approval.namespace,
        });
      });
  };

  const syncUnlockAttentionRequests = async (uiEntryAccess: BackgroundUiEntryAccess) => {
    if (!(await hasInitializedVault(uiEntryAccess))) {
      return;
    }

    const requests = await uiEntryAccess.listUnlockAttentionRequests();
    const request = requests.at(-1);
    if (!request) {
      return;
    }

    openNotificationForUnlockAttention(uiEntryAccess, request);
  };

  const syncPendingApprovals = async (uiEntryAccess: BackgroundUiEntryAccess) => {
    const approvals = await uiEntryAccess.listPendingApprovals();
    const providerApprovalIds = new Set(
      approvals.filter((approval) => approval.source === "provider").map((approval) => approval.approvalId),
    );

    for (const approvalId of Array.from(seenProviderApprovalIds)) {
      if (providerApprovalIds.has(approvalId)) {
        continue;
      }

      seenProviderApprovalIds.delete(approvalId);
      approvalWindowTracker.deleteApproval(approvalId);
    }

    if (providerApprovalIds.size === 0) {
      clearWindowTracking();
      return;
    }

    for (const approval of approvals) {
      if (approval.source !== "provider") {
        continue;
      }
      if (seenProviderApprovalIds.has(approval.approvalId)) {
        continue;
      }

      seenProviderApprovalIds.add(approval.approvalId);
      if (!(await hasInitializedVault(uiEntryAccess))) {
        continue;
      }

      openNotificationForApproval(uiEntryAccess, approval);
    }
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

  const start = async (): Promise<void> => {
    if (started) {
      return;
    }

    if (startTask) {
      return await startTask;
    }

    disposed = false;
    startTask = (async () => {
      try {
        const uiEntryAccess = await runtimeHost.getOrInitUiEntryAccess();
        if (disposed) {
          return;
        }

        subscriptions.push(
          uiEntryAccess.subscribeUnlockAttentionEvents(() => {
            void syncUnlockAttentionRequests(uiEntryAccess).catch((error) => {
              console.warn(LOG_PREFIX, "failed to sync unlock attention requests", error);
            });
          }),
        );
        subscriptions.push(
          uiEntryAccess.subscribeApprovalEvents(() => {
            void syncPendingApprovals(uiEntryAccess).catch((error) => {
              console.warn(LOG_PREFIX, "failed to sync pending approvals", error);
            });
          }),
        );

        await syncPendingApprovals(uiEntryAccess);
        await syncUnlockAttentionRequests(uiEntryAccess);

        started = true;
      } catch (error) {
        clearSubscriptions();
        clearWindowTracking();
        throw error;
      }
    })().finally(() => {
      startTask = null;
    });

    return await startTask;
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
