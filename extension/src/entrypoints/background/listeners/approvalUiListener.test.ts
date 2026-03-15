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
  #unlocked = true;
  #lockedHandlers = new Set<() => void>();
  #stateHandlers = new Set<() => void>();

  isUnlocked() {
    return this.#unlocked;
  }

  onLocked(handler: () => void) {
    this.#lockedHandlers.add(handler);
    return () => this.#lockedHandlers.delete(handler);
  }

  onStateChanged(handler: () => void) {
    this.#stateHandlers.add(handler);
    return () => this.#stateHandlers.delete(handler);
  }

  lock() {
    this.#unlocked = false;
    for (const handler of this.#lockedHandlers) {
      handler();
    }
    for (const handler of this.#stateHandlers) {
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

const buildHarness = (windowIds: number[]) => {
  const bus = new FakeBus();
  const approvals = new FakeApprovalsController();
  const unlock = new FakeUnlock();
  const trackedWindowClosers = new Map<number, () => void>();
  let openCallIndex = 0;

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
    getOrInitContext: vi.fn(async () => {
      throw new Error("approvalUiListener should not request the full runtime context");
    }) as unknown as BackgroundRuntimeHost["getOrInitContext"],
    getProviderSnapshot: vi.fn() as unknown as BackgroundRuntimeHost["getProviderSnapshot"],
    getOrInitUiBridgeAccess: vi.fn(async () => {
      throw new Error("UI bridge contract should not be requested in approvalUiListener tests");
    }) as unknown as BackgroundRuntimeHost["getOrInitUiBridgeAccess"],
    getOrInitProviderEventsAccess: vi.fn(async () => {
      throw new Error("Provider events contract should not be requested in approvalUiListener tests");
    }) as unknown as BackgroundRuntimeHost["getOrInitProviderEventsAccess"],
    getOrInitApprovalUiAccess: vi.fn(async () => ({
      subscribeAttentionRequested: (handler: (payload: unknown) => void) => bus.subscribe(ATTENTION_REQUESTED, handler),
      subscribeApprovalCreated: (handler: (event: { record: ApprovalRecordLike }) => void) =>
        approvals.onCreated(handler),
      subscribeApprovalFinished: (handler: (event: { id: string }) => void) => approvals.onFinished(handler),
      subscribeApprovalStateChanged: (handler: () => void) => approvals.onStateChanged(handler),
      subscribeSessionLocked: (handler: () => void) => unlock.onLocked(handler),
      subscribeSessionStateChanged: (handler: () => void) => unlock.onStateChanged(handler),
      cancelApproval: approvals.cancel,
      listPendingApprovalIds: () => approvals.getState().pending.map((item) => item.id),
      hasInitializedVault: () => true,
      isUnlocked: () => unlock.isUnlocked(),
    })) as unknown as BackgroundRuntimeHost["getOrInitApprovalUiAccess"],
    persistVaultMeta: vi.fn() as unknown as BackgroundRuntimeHost["persistVaultMeta"],
    destroy: vi.fn(),
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
    await vi.waitFor(() => expect(harness.runtimeHost.getOrInitApprovalUiAccess).toHaveBeenCalledTimes(1));
    expect(harness.runtimeHost.getOrInitContext).not.toHaveBeenCalled();

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
    await vi.waitFor(() => expect(harness.runtimeHost.getOrInitApprovalUiAccess).toHaveBeenCalledTimes(1));

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

  it("cancels all pending approvals with locked when the session locks", async () => {
    const harness = buildHarness([41]);
    const listener = createApprovalUiListener({ runtimeHost: harness.runtimeHost, platform: harness.platform });

    listener.start();
    await vi.waitFor(() => expect(harness.runtimeHost.getOrInitApprovalUiAccess).toHaveBeenCalledTimes(1));

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

    harness.unlock.lock();

    await vi.waitFor(() =>
      expect(harness.approvals.cancel.mock.calls).toEqual(
        expect.arrayContaining([
          [{ id: "provider-approval", reason: "locked" }],
          [{ id: "ui-approval", reason: "locked" }],
        ]),
      ),
    );

    expect(harness.approvals.getState().pending).toHaveLength(0);

    listener.destroy();
  });

  it("tracks unlock attention popups without cancelling unrelated approvals", async () => {
    const harness = buildHarness([51]);
    const listener = createApprovalUiListener({ runtimeHost: harness.runtimeHost, platform: harness.platform });

    listener.start();
    await vi.waitFor(() => expect(harness.runtimeHost.getOrInitApprovalUiAccess).toHaveBeenCalledTimes(1));

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
});
