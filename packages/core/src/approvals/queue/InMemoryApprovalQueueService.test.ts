import { afterEach, describe, expect, it, vi } from "vitest";
import { createMessenger } from "../../messenger/index.js";
import type { ApprovalExecutor } from "../types.js";
import { InMemoryApprovalQueueService } from "./InMemoryApprovalQueueService.js";
import {
  type ApprovalCreatedEvent,
  type ApprovalCreateParams,
  type ApprovalFinishedEvent,
  ApprovalKinds,
} from "./types.js";

const ORIGIN = "https://dapp.example";

const requester = {
  origin: ORIGIN,
  source: "provider" as const,
  requestId: "1",
};

const createRequest = (overrides?: Partial<ApprovalCreateParams<typeof ApprovalKinds.RequestAccounts>>) => {
  return {
    approvalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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

describe("InMemoryApprovalQueueService", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("create() requires requester", async () => {
    const messenger = createMessenger();
    const queue = new InMemoryApprovalQueueService({ messenger });
    const request = createRequest();

    // @ts-expect-error - requester is required
    expect(() => queue.create(request, null)).toThrow(/requester/i);
  });

  it("create() rejects approvals whose request chainRef does not match the record chainRef", async () => {
    const messenger = createMessenger();
    const queue = new InMemoryApprovalQueueService({ messenger });
    const request = createRequest({
      request: { chainRef: "eip155:10", suggestedAccounts: ["0xabc"] },
    });

    expect(() => queue.create(request, requester)).toThrow(/request chainref must match/i);
  });

  it("create() rejects request-permissions approvals with empty descriptor chainRefs", async () => {
    const messenger = createMessenger();
    const queue = new InMemoryApprovalQueueService({ messenger });
    const request = {
      approvalId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
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

    expect(() => queue.create(request, requester)).toThrow(/must include explicit chainrefs/i);
  });

  it("create() enqueues + resolve(approve) finalizes + resolves the original promise", async () => {
    const messenger = createMessenger();
    const value = ["0xabc"];
    const executor = createExecutor(value);
    const queue = new InMemoryApprovalQueueService({
      messenger,
      getExecutor: () => executor,
    });

    const request = createRequest({ approvalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    const handle = queue.create(request, requester);

    expect(queue.getState().pending.some((item) => item.approvalId === request.approvalId)).toBe(true);

    const resolved = await queue.resolve({ approvalId: request.approvalId, action: "approve" });

    await expect(handle.settled).resolves.toEqual(value);
    expect(queue.getState().pending.some((item) => item.approvalId === request.approvalId)).toBe(false);
    expect(executor.approve).toHaveBeenCalledTimes(1);
    expect(resolved).toEqual({
      approvalId: request.approvalId,
      status: "approved",
      terminalReason: "user_approve",
      value,
    });
  });

  it("allows synchronous onCreated handlers to resolve without races", async () => {
    const messenger = createMessenger();
    const value = ["0xabc"];
    const executor = createExecutor(value);
    const queue = new InMemoryApprovalQueueService({
      messenger,
      getExecutor: () => executor,
    });

    const request = createRequest({ approvalId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
    const unsubscribe = queue.onCreated(({ record }) => {
      void queue.resolve({ approvalId: record.approvalId, action: "approve" });
    });

    try {
      const handle = queue.create(request, requester);
      await expect(handle.settled).resolves.toEqual(value);
    } finally {
      unsubscribe();
    }
  });

  it("prevents duplicate approve execution while approval settlement is in flight", async () => {
    const messenger = createMessenger();
    const value = ["0xabc"];
    const approve = vi.fn(async () => {
      await Promise.resolve();
      return value;
    });
    const queue = new InMemoryApprovalQueueService({
      messenger,
      getExecutor: () => ({
        approve,
        reject: vi.fn(async () => {}),
        cancel: vi.fn(async () => {}),
      }),
    });

    const request = createRequest({ approvalId: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd" });
    const handle = queue.create(request, requester);

    const first = queue.resolve({ approvalId: request.approvalId, action: "approve" });
    const second = queue.resolve({ approvalId: request.approvalId, action: "approve" });

    await expect(first).resolves.toEqual({
      approvalId: request.approvalId,
      status: "approved",
      terminalReason: "user_approve",
      value,
    });
    await expect(second).rejects.toThrow(`Approval ${request.approvalId} not found`);
    await expect(handle.settled).resolves.toEqual(value);
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("cancel() rejects caller-disconnected approvals and removes them from state", async () => {
    const messenger = createMessenger();
    const queue = new InMemoryApprovalQueueService({ messenger });

    const request = createRequest({ approvalId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
    const handle = queue.create(request, requester);

    expect(queue.getState().pending.some((item) => item.approvalId === request.approvalId)).toBe(true);

    await queue.cancel({ approvalId: request.approvalId, reason: "caller_disconnected" });
    expect(queue.getState().pending.some((item) => item.approvalId === request.approvalId)).toBe(false);

    await expect(handle.settled).rejects.toMatchObject({ code: "global.transport.disconnected" });
  });

  it("resolve(reject) preserves caller-provided Error instance", async () => {
    const messenger = createMessenger();
    const queue = new InMemoryApprovalQueueService({ messenger });

    const request = createRequest({ approvalId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" });
    const handle = queue.create(request, requester);

    const custom = new Error("custom rejection");
    (custom as Error & { code?: string }).code = "approval.custom";

    await expect(queue.resolve({ approvalId: request.approvalId, action: "reject", error: custom })).resolves.toEqual({
      approvalId: request.approvalId,
      status: "rejected",
      terminalReason: "user_reject",
    });
    await expect(handle.settled).rejects.toBe(custom);
  });

  it("sorts pending approvals by createdAt and id", () => {
    const messenger = createMessenger();
    const queue = new InMemoryApprovalQueueService({ messenger });

    queue.create(createRequest({ approvalId: "approval-b", createdAt: 2_000 }), requester);
    queue.create(createRequest({ approvalId: "approval-a", createdAt: 2_000 }), requester);
    queue.create(createRequest({ approvalId: "approval-c", createdAt: 1_000 }), requester);

    expect(queue.getState().pending.map((item) => item.approvalId)).toEqual(["approval-c", "approval-a", "approval-b"]);
  });

  it("publishes onCreated and onFinished with explicit lifecycle semantics", async () => {
    const messenger = createMessenger();
    const value = ["0xabc"];
    const executor = createExecutor(value);
    const queue = new InMemoryApprovalQueueService({
      messenger,
      getExecutor: () => executor,
    });

    const createdEvents: ApprovalCreatedEvent[] = [];
    const finishedEvents: ApprovalFinishedEvent<unknown>[] = [];
    const unsubscribeCreated = queue.onCreated((event) => createdEvents.push(event));
    const unsubscribeFinished = queue.onFinished((event) => finishedEvents.push(event));

    try {
      const approvedRequest = createRequest({ approvalId: "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0" });
      await queue.resolve({
        approvalId: queue.create(approvedRequest, requester).approvalId,
        action: "approve",
      });

      const cancelledRequest = createRequest({ approvalId: "abababab-abab-4aba-8aba-abababababab" });
      const cancelledHandle = queue.create(cancelledRequest, requester);
      await queue.cancel({ approvalId: cancelledRequest.approvalId, reason: "locked" });
      await expect(cancelledHandle.settled).rejects.toMatchObject({ code: "global.session.locked" });

      expect(createdEvents.map((event) => event.record.approvalId)).toEqual([
        approvedRequest.approvalId,
        cancelledRequest.approvalId,
      ]);
      expect(finishedEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            approvalId: approvedRequest.approvalId,
            status: "approved",
            terminalReason: "user_approve",
            kind: approvedRequest.kind,
            origin: approvedRequest.origin,
            namespace: approvedRequest.namespace,
            chainRef: approvedRequest.chainRef,
            value,
          }),
          expect.objectContaining({
            approvalId: cancelledRequest.approvalId,
            status: "cancelled",
            terminalReason: "locked",
            kind: cancelledRequest.kind,
            origin: cancelledRequest.origin,
            namespace: cancelledRequest.namespace,
            chainRef: cancelledRequest.chainRef,
            error: expect.objectContaining({ code: "global.session.locked" }),
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
    const messenger = createMessenger();
    const queue = new InMemoryApprovalQueueService({
      messenger,
      ttlMs: 1_000,
    });

    const request = createRequest({ approvalId: "ffffffff-ffff-4fff-8fff-ffffffffffff" });
    const handle = queue.create(request, requester);

    expect(queue.getState().pending.some((item) => item.approvalId === request.approvalId)).toBe(true);

    vi.advanceTimersByTime(1_000);

    await expect(handle.settled).rejects.toMatchObject({ code: "approval.timeout" });
    expect(queue.getState().pending.some((item) => item.approvalId === request.approvalId)).toBe(false);
  });
});
