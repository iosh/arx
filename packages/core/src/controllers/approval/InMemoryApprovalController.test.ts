import { ArxReasons } from "@arx/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovalExecutor } from "../../approvals/types.js";
import { Messenger } from "../../messenger/Messenger.js";
import { InMemoryApprovalController } from "./InMemoryApprovalController.js";
import { APPROVAL_TOPICS } from "./topics.js";
import {
  type ApprovalCreatedEvent,
  type ApprovalCreateParams,
  type ApprovalFinishedEvent,
  ApprovalKinds,
} from "./types.js";

const ORIGIN = "https://dapp.example";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const requester = {
  transport: "provider" as const,
  portId: "p1",
  sessionId: SESSION_ID,
  requestId: "1",
  origin: ORIGIN,
};

const createRequest = (overrides?: Partial<ApprovalCreateParams<typeof ApprovalKinds.RequestAccounts>>) => {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    kind: ApprovalKinds.RequestAccounts,
    origin: ORIGIN,
    namespace: "eip155",
    chainRef: "eip155:1",
    createdAt: 1000,
    request: { chainRef: "eip155:1", suggestedAccounts: ["0xabc"] },
    ...overrides,
  } satisfies ApprovalCreateParams<typeof ApprovalKinds.RequestAccounts>;
};

const createExecutor = (value: unknown): ApprovalExecutor => ({
  approve: vi.fn(async () => value),
  reject: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
});

describe("InMemoryApprovalController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("create() requires requester", async () => {
    const messenger = new Messenger();
    const controller = new InMemoryApprovalController({ messenger: messenger.scope({ publish: APPROVAL_TOPICS }) });
    const request = createRequest();

    // @ts-expect-error - requester is required
    expect(() => controller.create(request, null)).toThrow(/requester/i);
  });

  it("create() rejects approvals whose request chainRef does not match the record chainRef", async () => {
    const messenger = new Messenger();
    const controller = new InMemoryApprovalController({ messenger: messenger.scope({ publish: APPROVAL_TOPICS }) });
    const request = createRequest({
      request: { chainRef: "eip155:10", suggestedAccounts: ["0xabc"] },
    });

    expect(() => controller.create(request, requester)).toThrow(/request chainref must match/i);
  });

  it("create() rejects request-permissions approvals with empty descriptor chainRefs", async () => {
    const messenger = new Messenger();
    const controller = new InMemoryApprovalController({ messenger: messenger.scope({ publish: APPROVAL_TOPICS }) });
    const request = {
      id: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
      kind: ApprovalKinds.RequestPermissions,
      origin: ORIGIN,
      namespace: "eip155",
      chainRef: "eip155:1",
      createdAt: 1000,
      request: {
        chainRef: "eip155:1",
        requestedGrants: [
          {
            grantKind: "eth_accounts",
            chainRefs: [],
          },
        ],
      },
    } as unknown as ApprovalCreateParams<typeof ApprovalKinds.RequestPermissions>;

    expect(() => controller.create(request, requester)).toThrow(/must include explicit chainrefs/i);
  });

  it("create() enqueues + resolve(approve) finalizes + resolves the original promise", async () => {
    const messenger = new Messenger();
    const value = ["0xabc"];
    const executor = createExecutor(value);
    const controller = new InMemoryApprovalController({
      messenger: messenger.scope({ publish: APPROVAL_TOPICS }),
      getExecutor: () => executor,
    });

    const request = createRequest({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    const handle = controller.create(request, requester);

    expect(controller.getState().pending.some((item) => item.id === request.id)).toBe(true);

    const resolved = await controller.resolve({ id: request.id, action: "approve" });

    await expect(handle.settled).resolves.toEqual(value);
    expect(controller.getState().pending.some((item) => item.id === request.id)).toBe(false);
    expect(executor.approve).toHaveBeenCalledTimes(1);
    expect(resolved).toEqual({
      id: request.id,
      status: "approved",
      terminalReason: "user_approve",
      value,
    });
  });

  it("allows synchronous onCreated handlers to resolve without races", async () => {
    const messenger = new Messenger();
    const value = ["0xabc"];
    const executor = createExecutor(value);
    const controller = new InMemoryApprovalController({
      messenger: messenger.scope({ publish: APPROVAL_TOPICS }),
      getExecutor: () => executor,
    });

    const request = createRequest({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
    const unsubscribe = controller.onCreated(({ record }) => {
      void controller.resolve({ id: record.id, action: "approve" });
    });

    try {
      const handle = controller.create(request, requester);
      await expect(handle.settled).resolves.toEqual(value);
    } finally {
      unsubscribe();
    }
  });

  it("cancelByScope() rejects matching approvals and removes them from state", async () => {
    const messenger = new Messenger();
    const controller = new InMemoryApprovalController({ messenger: messenger.scope({ publish: APPROVAL_TOPICS }) });

    const request = createRequest({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
    const handle = controller.create(request, requester);

    expect(controller.getState().pending.some((item) => item.id === request.id)).toBe(true);

    const count = await controller.cancelByScope({
      scope: {
        transport: "provider",
        origin: ORIGIN,
        portId: "p1",
        sessionId: SESSION_ID,
      },
      reason: "session_lost",
    });
    expect(count).toBe(1);
    expect(controller.getState().pending.some((item) => item.id === request.id)).toBe(false);

    await expect(handle.settled).rejects.toMatchObject({ reason: ArxReasons.TransportDisconnected });
  });

  it("resolve(reject) preserves caller-provided Error instance", async () => {
    const messenger = new Messenger();
    const controller = new InMemoryApprovalController({ messenger: messenger.scope({ publish: APPROVAL_TOPICS }) });

    const request = createRequest({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" });
    const handle = controller.create(request, requester);

    const custom = new Error("custom rejection");
    (custom as Error & { code?: number }).code = 4001;

    await expect(controller.resolve({ id: request.id, action: "reject", error: custom })).resolves.toEqual({
      id: request.id,
      status: "rejected",
      terminalReason: "user_reject",
    });
    await expect(handle.settled).rejects.toBe(custom);
  });

  it("sorts pending approvals by createdAt and id", () => {
    const messenger = new Messenger();
    const controller = new InMemoryApprovalController({ messenger: messenger.scope({ publish: APPROVAL_TOPICS }) });

    controller.create(createRequest({ id: "approval-b", createdAt: 2_000 }), requester);
    controller.create(createRequest({ id: "approval-a", createdAt: 2_000 }), requester);
    controller.create(createRequest({ id: "approval-c", createdAt: 1_000 }), requester);

    expect(controller.getState().pending.map((item) => item.id)).toEqual(["approval-c", "approval-a", "approval-b"]);
  });

  it("publishes onCreated and onFinished with explicit lifecycle semantics", async () => {
    const messenger = new Messenger();
    const value = ["0xabc"];
    const executor = createExecutor(value);
    const controller = new InMemoryApprovalController({
      messenger: messenger.scope({ publish: APPROVAL_TOPICS }),
      getExecutor: () => executor,
    });

    const createdEvents: ApprovalCreatedEvent[] = [];
    const finishedEvents: ApprovalFinishedEvent<unknown>[] = [];
    const unsubscribeCreated = controller.onCreated((event) => createdEvents.push(event));
    const unsubscribeFinished = controller.onFinished((event) => finishedEvents.push(event));

    try {
      const approvedRequest = createRequest({ id: "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0" });
      await controller.resolve({ id: controller.create(approvedRequest, requester).id, action: "approve" });

      const cancelledRequest = createRequest({ id: "abababab-abab-4aba-8aba-abababababab" });
      const cancelledHandle = controller.create(cancelledRequest, requester);
      await controller.cancel({ id: cancelledRequest.id, reason: "locked" });
      await expect(cancelledHandle.settled).rejects.toMatchObject({ reason: ArxReasons.SessionLocked });

      expect(createdEvents.map((event) => event.record.id)).toEqual([approvedRequest.id, cancelledRequest.id]);
      expect(finishedEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: approvedRequest.id,
            status: "approved",
            terminalReason: "user_approve",
            kind: approvedRequest.kind,
            origin: approvedRequest.origin,
            namespace: approvedRequest.namespace,
            chainRef: approvedRequest.chainRef,
            value,
          }),
          expect.objectContaining({
            id: cancelledRequest.id,
            status: "cancelled",
            terminalReason: "locked",
            kind: cancelledRequest.kind,
            origin: cancelledRequest.origin,
            namespace: cancelledRequest.namespace,
            chainRef: cancelledRequest.chainRef,
            error: expect.objectContaining({ message: "Wallet is locked." }),
          }),
        ]),
      );
    } finally {
      unsubscribeCreated();
      unsubscribeFinished();
    }
  });

  it("expires approvals after ttlMs to avoid hanging requests", async () => {
    vi.useFakeTimers();
    const messenger = new Messenger();
    const controller = new InMemoryApprovalController({
      messenger: messenger.scope({ publish: APPROVAL_TOPICS }),
      ttlMs: 1_000,
    });

    const request = createRequest({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff" });
    const handle = controller.create(request, requester);

    expect(controller.getState().pending.some((item) => item.id === request.id)).toBe(true);

    vi.advanceTimersByTime(1_000);

    await expect(handle.settled).rejects.toMatchObject({ reason: ArxReasons.ApprovalTimeout });
    expect(controller.getState().pending.some((item) => item.id === request.id)).toBe(false);
  });
});
