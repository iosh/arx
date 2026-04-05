import { ApprovalKinds, type ApprovalQueueItem, type ApprovalRecord } from "@arx/core/controllers/approval";
import { ATTENTION_REQUESTED } from "@arx/core/services";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UiPlatform } from "../platform/uiPlatform";
import type { BackgroundRuntimeHost } from "../runtimeHost";
import { createApprovalUiListener } from "./approvalUiListener";

type ApprovalRecordLike = Pick<
  ApprovalRecord,
  "id" | "kind" | "origin" | "namespace" | "chainRef" | "request" | "createdAt" | "requester"
>;

type ApprovalQueueItemLike = Pick<ApprovalQueueItem, "id" | "kind" | "origin" | "namespace" | "chainRef" | "createdAt">;

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

class FakeApprovalsController {
  #pending: ApprovalQueueItemLike[] = [];
  #createdHandlers = new Set<(event: { record: ApprovalRecordLike }) => void>();
  #finishedHandlers = new Set<(event: { id: string }) => void>();
  #stateHandlers = new Set<() => void>();

  cancel = vi.fn(async ({ id }: { id: string; reason: string }) => {
    const nextPending = this.#pending.filter((item) => item.id !== id);
    if (nextPending.length === this.#pending.length) {
      return;
    }

    this.#pending = nextPending;
    this.#emitState();
    for (const handler of this.#finishedHandlers) {
      handler({ id });
    }
  });

  getState() {
    return { pending: [...this.#pending] };
  }

  onCreated(handler: (event: { record: ApprovalRecordLike }) => void) {
    this.#createdHandlers.add(handler);
    return () => this.#createdHandlers.delete(handler);
  }

  onFinished(handler: (event: { id: string }) => void) {
    this.#finishedHandlers.add(handler);
    return () => this.#finishedHandlers.delete(handler);
  }

  onStateChanged(handler: () => void) {
    this.#stateHandlers.add(handler);
    return () => this.#stateHandlers.delete(handler);
  }

  add(record: ApprovalRecordLike) {
    this.#pending = [
      ...this.#pending,
      {
        id: record.id,
        kind: record.kind,
        origin: record.origin,
        namespace: record.namespace,
        chainRef: record.chainRef,
        createdAt: record.createdAt,
      },
    ];
    this.#emitState();
    for (const handler of this.#createdHandlers) {
      handler({ record });
    }
  }

  #emitState() {
    for (const handler of this.#stateHandlers) {
      handler();
    }
  }
}

class FakeUnlock {
  #lockedHandlers = new Set<() => void>();

  onLocked(handler: () => void) {
    this.#lockedHandlers.add(handler);
    return () => this.#lockedHandlers.delete(handler);
  }

  lock() {
    for (const handler of this.#lockedHandlers) {
      handler();
    }
  }
}

const createRecord = (overrides?: Partial<ApprovalRecordLike>): ApprovalRecordLike => ({
  id: overrides?.id ?? "approval-1",
  kind: overrides?.kind ?? ApprovalKinds.RequestAccounts,
  origin: overrides?.origin ?? "https://dapp.example",
  namespace: overrides?.namespace ?? "eip155",
  chainRef: overrides?.chainRef ?? "eip155:1",
  request: overrides?.request ?? { chainRef: overrides?.chainRef ?? "eip155:1" },
  createdAt: overrides?.createdAt ?? Date.now(),
  requester: {
    transport: overrides?.requester?.transport ?? "provider",
    origin: overrides?.requester?.origin ?? "https://dapp.example",
    portId: overrides?.requester?.portId ?? "port-1",
    sessionId: overrides?.requester?.sessionId ?? "11111111-1111-4111-8111-111111111111",
    requestId: overrides?.requester?.requestId ?? "request-1",
  },
});

const buildHarness = (
  windowIds: number[],
  options?: {
    failFirstApprovalUiAccess?: boolean;
  },
) => {
  const bus = new FakeBus();
  const approvals = new FakeApprovalsController();
  const unlock = new FakeUnlock();
  const trackedWindowClosers = new Map<number, () => void>();
  let openCallIndex = 0;
  let shouldFailFirstApprovalUiAccess = options?.failFirstApprovalUiAccess ?? false;

  const platform: UiPlatform = {
    openOnboardingTab: vi.fn(async () => ({ activationPath: "create" as const })),
    openNotificationPopup: vi.fn(async () => ({
      activationPath: "create" as const,
      windowId: windowIds[openCallIndex++],
    })),
    trackWindowClose: vi.fn((windowId: number, onClose: () => void) => {
      trackedWindowClosers.set(windowId, onClose);
    }),
    clearWindowCloseTracks: vi.fn(() => {
      trackedWindowClosers.clear();
    }),
    teardown: vi.fn(),
  };

  const runtimeHost: BackgroundRuntimeHost = {
    initializeRuntime: vi.fn(async () => {}),
    getOrInitProviderAccess: vi.fn(async () => {
      throw new Error("Provider bridge access should not be requested in approvalUiListener tests");
    }) as unknown as BackgroundRuntimeHost["getOrInitProviderAccess"],
    getOrInitUiAccess: vi.fn(async () => {
      throw new Error("UI bridge access should not be requested in approvalUiListener tests");
    }) as unknown as BackgroundRuntimeHost["getOrInitUiAccess"],
    getOrInitApprovalPopupAccess: vi.fn(async () => {
      if (shouldFailFirstApprovalUiAccess) {
        shouldFailFirstApprovalUiAccess = false;
        throw new Error("approval ui access bootstrap failed");
      }

      return {
        subscribeUnlockAttentionRequested: (handler: (payload: unknown) => void) =>
          bus.subscribe(ATTENTION_REQUESTED, handler),
        subscribeApprovalCreated: (handler: (event: { record: ApprovalRecordLike }) => void) =>
          approvals.onCreated(handler),
        subscribeApprovalFinished: (handler: (event: { id: string }) => void) => approvals.onFinished(handler),
        subscribeApprovalStateChanged: (handler: () => void) => approvals.onStateChanged(handler),
        subscribeSessionLocked: (handler: () => void) => unlock.onLocked(handler),
        cancelApproval: approvals.cancel,
        cancelPendingApprovals: async (reason: string) => {
          const pendingIds = approvals.getState().pending.map((item) => item.id);
          await Promise.all(pendingIds.map((id) => approvals.cancel({ id, reason })));
        },
        getPendingApprovalCount: () => approvals.getState().pending.length,
        hasInitializedVault: () => true,
      };
    }) as unknown as BackgroundRuntimeHost["getOrInitApprovalPopupAccess"],
    shutdown: vi.fn(async () => {}),
    applyDebugNamespacesFromEnv: vi.fn(),
  };

  return {
    approvals,
    bus,
    platform,
    runtimeHost,
    unlock,
    closeWindow(windowId: number) {
      trackedWindowClosers.get(windowId)?.();
    },
  };
};

describe("approvalUiListener", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cancels only approvals attached to the closed popup window", async () => {
    const harness = buildHarness([11, 22]);
    const listener = createApprovalUiListener({ runtimeHost: harness.runtimeHost, platform: harness.platform });

    listener.start();
    await vi.waitFor(() => expect(harness.runtimeHost.getOrInitApprovalPopupAccess).toHaveBeenCalledTimes(1));

    harness.approvals.add(createRecord({ id: "approval-1" }));
    harness.approvals.add(
      createRecord({
        id: "approval-2",
        requester: {
          transport: "provider",
          origin: "https://dapp.example",
          portId: "port-2",
          sessionId: "22222222-2222-4222-8222-222222222222",
          requestId: "request-2",
        },
      }),
    );

    await vi.waitFor(() => expect(harness.platform.openNotificationPopup).toHaveBeenCalledTimes(2));

    harness.closeWindow(11);

    await vi.waitFor(() =>
      expect(harness.approvals.cancel).toHaveBeenCalledWith({ id: "approval-1", reason: "window_closed" }),
    );

    expect(harness.approvals.cancel).not.toHaveBeenCalledWith({ id: "approval-2", reason: "window_closed" });
    expect(harness.approvals.getState().pending.map((item) => item.id)).toEqual(["approval-2"]);

    listener.destroy();
  });

  it("does not cancel UI-origin approvals when a provider popup closes", async () => {
    const harness = buildHarness([31]);
    const listener = createApprovalUiListener({ runtimeHost: harness.runtimeHost, platform: harness.platform });

    listener.start();
    await vi.waitFor(() => expect(harness.runtimeHost.getOrInitApprovalPopupAccess).toHaveBeenCalledTimes(1));

    harness.approvals.add(createRecord({ id: "provider-approval" }));
    harness.approvals.add(
      createRecord({
        id: "ui-approval",
        requester: {
          transport: "ui",
          origin: "chrome-extension://wallet",
          portId: "ui-port",
          sessionId: "33333333-3333-4333-8333-333333333333",
          requestId: "ui-request",
        },
      }),
    );

    await vi.waitFor(() => expect(harness.platform.openNotificationPopup).toHaveBeenCalledTimes(1));

    harness.closeWindow(31);

    await vi.waitFor(() =>
      expect(harness.approvals.cancel).toHaveBeenCalledWith({ id: "provider-approval", reason: "window_closed" }),
    );

    expect(harness.approvals.getState().pending.map((item) => item.id)).toEqual(["ui-approval"]);

    listener.destroy();
  });

  it("keeps pending approvals alive when the session locks and still cancels them if the tracked popup closes", async () => {
    const harness = buildHarness([41]);
    const listener = createApprovalUiListener({ runtimeHost: harness.runtimeHost, platform: harness.platform });

    listener.start();
    await vi.waitFor(() => expect(harness.runtimeHost.getOrInitApprovalPopupAccess).toHaveBeenCalledTimes(1));

    harness.approvals.add(createRecord({ id: "provider-approval" }));
    harness.approvals.add(
      createRecord({
        id: "ui-approval",
        requester: {
          transport: "ui",
          origin: "chrome-extension://wallet",
          portId: "ui-port",
          sessionId: "33333333-3333-4333-8333-333333333333",
          requestId: "ui-request",
        },
      }),
    );

    await vi.waitFor(() => expect(harness.platform.openNotificationPopup).toHaveBeenCalledTimes(1));

    harness.unlock.lock();
    expect(harness.approvals.cancel).not.toHaveBeenCalled();
    expect(harness.approvals.getState().pending.map((item) => item.id)).toEqual(["provider-approval", "ui-approval"]);

    harness.closeWindow(41);

    await vi.waitFor(() =>
      expect(harness.approvals.cancel).toHaveBeenCalledWith({ id: "provider-approval", reason: "window_closed" }),
    );

    expect(harness.approvals.getState().pending.map((item) => item.id)).toEqual(["ui-approval"]);

    listener.destroy();
  });

  it("tracks unlock attention popups without cancelling unrelated approvals", async () => {
    const harness = buildHarness([51]);
    const listener = createApprovalUiListener({ runtimeHost: harness.runtimeHost, platform: harness.platform });

    listener.start();
    await vi.waitFor(() => expect(harness.runtimeHost.getOrInitApprovalPopupAccess).toHaveBeenCalledTimes(1));

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

    listener.destroy();
  });

  it("retries initialization after the first approval UI access bootstrap failure", async () => {
    const harness = buildHarness([61], { failFirstApprovalUiAccess: true });
    const listener = createApprovalUiListener({ runtimeHost: harness.runtimeHost, platform: harness.platform });

    listener.start();
    await vi.waitFor(() => expect(harness.runtimeHost.getOrInitApprovalPopupAccess).toHaveBeenCalledTimes(1));
    expect(harness.platform.openNotificationPopup).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      listener.start();
      expect(harness.runtimeHost.getOrInitApprovalPopupAccess).toHaveBeenCalledTimes(2);
    });

    harness.bus.emit(ATTENTION_REQUESTED, {
      reason: "unlock_required",
      origin: "https://dapp.example",
      method: "eth_requestAccounts",
      chainRef: "eip155:1",
      namespace: "eip155",
    });

    await vi.waitFor(() => expect(harness.platform.openNotificationPopup).toHaveBeenCalledTimes(1));

    listener.destroy();
  });
});
