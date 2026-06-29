import { ApprovalKinds, type ApprovalQueueItem, type ApprovalRecord } from "@arx/core/approvals";
import { ATTENTION_REQUESTED } from "@arx/core/services";
import type { ApprovalDetail, ApprovalListEntry } from "@arx/core/wallet";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UiEntryPlatform } from "../platform/uiPlatform";
import type { BackgroundUiEntryAccess } from "../runtimeHost";
import { createUiEntryCoordinator } from "./uiEntryCoordinator";

type ApprovalRecordLike = Pick<
  ApprovalRecord,
  "approvalId" | "kind" | "origin" | "namespace" | "chainRef" | "request" | "createdAt" | "requester"
>;

type ApprovalQueueItemLike = Pick<
  ApprovalQueueItem,
  "approvalId" | "kind" | "source" | "origin" | "namespace" | "chainRef" | "createdAt"
>;
type NotificationOpenResult = Awaited<ReturnType<UiEntryPlatform["openNotificationPopup"]>>;
type OnboardingOpenResult = Awaited<ReturnType<UiEntryPlatform["openOnboardingTab"]>>;
type UiEntryRuntimeHost = {
  getOrInitUiEntryAccess: () => Promise<BackgroundUiEntryAccess>;
};

class FakeBus {
  #handlers = new Map<unknown, Set<(payload: unknown) => void>>();

  subscribe(topic: unknown, handler: (payload: unknown) => void) {
    const handlers = this.#handlers.get(topic) ?? new Set<(payload: unknown) => void>();
    handlers.add(handler);
    this.#handlers.set(topic, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.#handlers.delete(topic);
      }
    };
  }

  emit(topic: unknown, payload: unknown) {
    const handlers = this.#handlers.get(topic);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(payload);
    }
  }
}

class FakeApprovalQueueService {
  #pending: ApprovalQueueItemLike[] = [];

  cancel = vi.fn(async ({ approvalId }: { approvalId: string; reason: string }) => {
    const nextPending = this.#pending.filter((item) => item.approvalId !== approvalId);
    if (nextPending.length === this.#pending.length) {
      return;
    }

    this.#pending = nextPending;
  });

  getState() {
    return { pending: [...this.#pending] };
  }

  add(record: ApprovalRecordLike) {
    this.#pending = [
      ...this.#pending,
      {
        approvalId: record.approvalId,
        kind: record.kind,
        source: record.requester.source,
        origin: record.origin,
        namespace: record.namespace,
        chainRef: record.chainRef,
        createdAt: record.createdAt,
      },
    ];
  }
}

const createRecord = (overrides?: Partial<ApprovalRecordLike>): ApprovalRecordLike => ({
  approvalId: overrides?.approvalId ?? "approval-1",
  kind: overrides?.kind ?? ApprovalKinds.RequestAccounts,
  origin: overrides?.origin ?? "https://dapp.example",
  namespace: overrides?.namespace ?? "eip155",
  chainRef: overrides?.chainRef ?? "eip155:1",
  request: overrides?.request ?? { chainRef: overrides?.chainRef ?? "eip155:1" },
  createdAt: overrides?.createdAt ?? Date.now(),
  requester: {
    origin: overrides?.requester?.origin ?? "https://dapp.example",
    source: overrides?.requester?.source ?? "provider",
    requestId: overrides?.requester?.requestId ?? "request-1",
  },
});

const createApprovalDetail = (approvalId: string): ApprovalDetail => ({
  approvalId,
  kind: "requestAccounts",
  source: "provider",
  origin: "https://dapp.example",
  namespace: "eip155",
  chainRef: "eip155:1",
  createdAt: 1,
  actions: {
    canApprove: true,
    canReject: true,
  },
  request: {
    selectableAccounts: [],
    recommendedAccountKey: null,
  },
  review: null,
});

const buildHarness = (
  windowIds: number[],
  options?: {
    failFirstUiEntryAccess?: boolean;
    notificationOpenResults?: NotificationOpenResult[];
    onboardingOpenResults?: OnboardingOpenResult[];
  },
) => {
  const bus = new FakeBus();
  const approvals = new FakeApprovalQueueService();
  const trackedWindowClosers = new Map<number, () => void>();
  const notificationOpenResults =
    options?.notificationOpenResults ??
    windowIds.map((windowId) => ({
      activationPath: "create" as const,
      windowId,
    }));
  const onboardingOpenResults = options?.onboardingOpenResults ?? [{ activationPath: "create" as const }];
  let notificationOpenCallIndex = 0;
  let onboardingOpenCallIndex = 0;
  let shouldFailFirstUiEntryAccess = options?.failFirstUiEntryAccess ?? false;
  const onEntryChanged = vi.fn();
  const approvalDetails = new Map<string, ApprovalDetail>();
  const approvalInvalidationHandlers = new Set<() => void>();

  const listPendingApprovals = (): ApprovalListEntry[] =>
    approvals.getState().pending.map((item) => ({
      approvalId: item.approvalId,
      kind: item.kind,
      source: item.source,
      origin: item.origin,
      namespace: item.namespace,
      chainRef: item.chainRef,
      createdAt: item.createdAt,
    }));

  const platform: UiEntryPlatform = {
    openOnboardingTab: vi.fn(async () => {
      const result =
        onboardingOpenResults[Math.min(onboardingOpenCallIndex, onboardingOpenResults.length - 1)] ??
        ({ activationPath: "create" as const } satisfies OnboardingOpenResult);
      onboardingOpenCallIndex += 1;
      return result;
    }),
    openNotificationPopup: vi.fn(async () => {
      const result =
        notificationOpenResults[Math.min(notificationOpenCallIndex, notificationOpenResults.length - 1)] ??
        ({ activationPath: "create" as const } satisfies NotificationOpenResult);
      notificationOpenCallIndex += 1;
      return result;
    }),
    trackWindowClose: vi.fn((windowId: number, onClose: () => void) => {
      trackedWindowClosers.set(windowId, onClose);
    }),
    clearWindowCloseTracks: vi.fn(() => {
      trackedWindowClosers.clear();
    }),
    teardown: vi.fn(),
  };

  const runtimeHost: UiEntryRuntimeHost = {
    getOrInitUiEntryAccess: vi.fn(async () => {
      if (shouldFailFirstUiEntryAccess) {
        shouldFailFirstUiEntryAccess = false;
        throw new Error("ui entry access bootstrap failed");
      }

      return {
        subscribeUnlockAttentionRequested: (handler: (payload: unknown) => void) =>
          bus.subscribe(ATTENTION_REQUESTED, handler),
        subscribeApprovalInvalidation: (handler: () => void) => {
          approvalInvalidationHandlers.add(handler);
          return () => approvalInvalidationHandlers.delete(handler);
        },
        dismissApproval: async ({ approvalId }: { approvalId: string }) => {
          await approvals.cancel({ approvalId, reason: "user_dismissed" });
        },
        listPendingApprovals: async () => listPendingApprovals(),
        getApprovalDetail: async (approvalId: string) => approvalDetails.get(approvalId) ?? null,
        hasInitializedVault: () => true,
      };
    }) as unknown as UiEntryRuntimeHost["getOrInitUiEntryAccess"],
  };

  return {
    approvals,
    bus,
    onEntryChanged,
    platform,
    runtimeHost,
    emitApprovalInvalidation() {
      for (const handler of approvalInvalidationHandlers) {
        handler();
      }
    },
    setApprovalDetail(detail: ApprovalDetail) {
      approvalDetails.set(detail.approvalId, detail);
    },
    closeWindow(windowId: number) {
      trackedWindowClosers.get(windowId)?.();
    },
  };
};

describe("uiEntryCoordinator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cancels only approvals attached to the closed popup window", async () => {
    const harness = buildHarness([11, 22]);
    const coordinator = createUiEntryCoordinator({
      runtimeHost: harness.runtimeHost,
      platform: harness.platform,
      onEntryChanged: harness.onEntryChanged,
    });

    await coordinator.start();
    expect(harness.runtimeHost.getOrInitUiEntryAccess).toHaveBeenCalledTimes(1);

    harness.approvals.add(createRecord({ approvalId: "approval-1" }));
    harness.approvals.add(
      createRecord({
        approvalId: "approval-2",
        requester: {
          origin: "https://dapp.example",
          source: "provider",
          requestId: "request-2",
        },
      }),
    );
    harness.emitApprovalInvalidation();

    await vi.waitFor(() => expect(harness.platform.openNotificationPopup).toHaveBeenCalledTimes(2));

    harness.closeWindow(11);

    await vi.waitFor(() =>
      expect(harness.approvals.cancel).toHaveBeenCalledWith({ approvalId: "approval-1", reason: "user_dismissed" }),
    );

    expect(harness.approvals.cancel).not.toHaveBeenCalledWith({
      approvalId: "approval-2",
      reason: "user_dismissed",
    });
    expect(harness.approvals.getState().pending.map((item) => item.approvalId)).toEqual(["approval-2"]);

    coordinator.destroy();
  });

  it("does not cancel UI-origin approvals when a provider popup closes", async () => {
    const harness = buildHarness([31]);
    const coordinator = createUiEntryCoordinator({
      runtimeHost: harness.runtimeHost,
      platform: harness.platform,
      onEntryChanged: harness.onEntryChanged,
    });

    await coordinator.start();
    expect(harness.runtimeHost.getOrInitUiEntryAccess).toHaveBeenCalledTimes(1);

    harness.approvals.add(createRecord({ approvalId: "provider-approval" }));
    harness.approvals.add(
      createRecord({
        approvalId: "ui-approval",
        requester: {
          origin: "chrome-extension://wallet",
          source: "wallet-ui",
          requestId: "ui-request",
        },
      }),
    );
    harness.emitApprovalInvalidation();

    await vi.waitFor(() => expect(harness.platform.openNotificationPopup).toHaveBeenCalledTimes(1));

    harness.closeWindow(31);

    await vi.waitFor(() =>
      expect(harness.approvals.cancel).toHaveBeenCalledWith({
        approvalId: "provider-approval",
        reason: "user_dismissed",
      }),
    );

    expect(harness.approvals.getState().pending.map((item) => item.approvalId)).toEqual(["ui-approval"]);

    coordinator.destroy();
  });

  it("tracks unlock attention popups without cancelling unrelated approvals", async () => {
    const harness = buildHarness([51]);
    const coordinator = createUiEntryCoordinator({
      runtimeHost: harness.runtimeHost,
      platform: harness.platform,
      onEntryChanged: harness.onEntryChanged,
    });

    await coordinator.start();
    expect(harness.runtimeHost.getOrInitUiEntryAccess).toHaveBeenCalledTimes(1);

    harness.bus.emit(ATTENTION_REQUESTED, {
      reason: "unlock_required",
      origin: "https://dapp.example",
      method: "eth_requestAccounts",
      chainRef: "eip155:1",
      namespace: "eip155",
    });

    await vi.waitFor(() => expect(harness.platform.openNotificationPopup).toHaveBeenCalledTimes(1));

    harness.closeWindow(51);

    expect(harness.approvals.cancel).not.toHaveBeenCalled();

    coordinator.destroy();
  });

  it("retries initialization after the first ui entry access bootstrap failure", async () => {
    const harness = buildHarness([61], { failFirstUiEntryAccess: true });
    const coordinator = createUiEntryCoordinator({
      runtimeHost: harness.runtimeHost,
      platform: harness.platform,
      onEntryChanged: harness.onEntryChanged,
    });

    await expect(coordinator.start()).rejects.toThrow("ui entry access bootstrap failed");
    expect(harness.runtimeHost.getOrInitUiEntryAccess).toHaveBeenCalledTimes(1);
    expect(harness.platform.openNotificationPopup).not.toHaveBeenCalled();

    await coordinator.start();
    expect(harness.runtimeHost.getOrInitUiEntryAccess).toHaveBeenCalledTimes(2);

    harness.bus.emit(ATTENTION_REQUESTED, {
      reason: "unlock_required",
      origin: "https://dapp.example",
      method: "eth_requestAccounts",
      chainRef: "eip155:1",
      namespace: "eip155",
    });

    await vi.waitFor(() => expect(harness.platform.openNotificationPopup).toHaveBeenCalledTimes(1));

    coordinator.destroy();
  });

  it("defaults notification launch context to idle until shell state activates it", async () => {
    const harness = buildHarness([]);
    const coordinator = createUiEntryCoordinator({
      runtimeHost: harness.runtimeHost,
      platform: harness.platform,
      onEntryChanged: harness.onEntryChanged,
    });

    expect(coordinator.getEntryLaunchContext({ environment: "notification" })).toEqual({
      environment: "notification",
      reason: "idle",
      context: {
        approvalId: null,
        origin: null,
        method: null,
        chainRef: null,
        namespace: null,
      },
    });
    expect(harness.onEntryChanged).not.toHaveBeenCalled();
  });

  it("builds bootstrap with an initial approval detail for approval-created entries", async () => {
    const harness = buildHarness([71]);
    const coordinator = createUiEntryCoordinator({
      runtimeHost: harness.runtimeHost,
      platform: harness.platform,
      onEntryChanged: harness.onEntryChanged,
    });

    await coordinator.start();
    expect(harness.runtimeHost.getOrInitUiEntryAccess).toHaveBeenCalledTimes(1);

    harness.setApprovalDetail(createApprovalDetail("approval-1"));
    harness.approvals.add(createRecord({ approvalId: "approval-1" }));
    harness.emitApprovalInvalidation();
    await vi.waitFor(() =>
      expect(coordinator.getEntryLaunchContext({ environment: "notification" })).toMatchObject({
        reason: "approval_created",
        context: {
          approvalId: "approval-1",
        },
      }),
    );

    const bootstrap = await coordinator.getEntryBootstrap({ environment: "notification" });

    expect(bootstrap).toEqual({
      entry: {
        environment: "notification",
        reason: "approval_created",
        context: {
          approvalId: "approval-1",
          origin: "https://dapp.example",
          method: "wallet_requestAccounts",
          chainRef: "eip155:1",
          namespace: "eip155",
        },
      },
      requestedApproval: {
        approvalId: "approval-1",
        initialDetail: createApprovalDetail("approval-1"),
      },
    });
  });

  it("reuses an existing onboarding tab without reloading it", async () => {
    const harness = buildHarness([], {
      onboardingOpenResults: [{ activationPath: "focus", tabId: 9 }],
    });
    const coordinator = createUiEntryCoordinator({
      runtimeHost: harness.runtimeHost,
      platform: harness.platform,
      onEntryChanged: harness.onEntryChanged,
    });

    await coordinator.openOnboardingTab("install");

    expect(harness.platform.openOnboardingTab).toHaveBeenCalledWith("install");
    expect(coordinator.getEntryLaunchContext({ environment: "onboarding" }).reason).toBe("install");
  });
});
