import { afterEach, describe, expect, it, vi } from "vitest";
import { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import { InMemoryApprovalController } from "./InMemoryApprovalController.js";
import type { ApprovalMessengerTopics, ApprovalTask } from "./types.js";

const ORIGIN = "https://dapp.example";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("InMemoryApprovalController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("requestApproval() requires requestContext", async () => {
    const messenger = new ControllerMessenger<ApprovalMessengerTopics>({});
    const controller = new InMemoryApprovalController({ messenger });

    const task: ApprovalTask = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      type: "wallet_requestAccounts",
      origin: ORIGIN,
      namespace: "eip155",
      chainRef: "eip155:1",
      createdAt: 1000,
      payload: { suggestedAccounts: ["0xabc"] },
    };

    // @ts-expect-error - requestContext is required
    await expect(controller.requestApproval(task, null)).rejects.toThrow(/requestContext/i);
  });

  it("requestApproval() enqueues + resolve() finalizes + resolves the original promise", async () => {
    const messenger = new ControllerMessenger<ApprovalMessengerTopics>({});
    const controller = new InMemoryApprovalController({ messenger });

    const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const task: ApprovalTask = {
      id,
      type: "wallet_requestAccounts",
      origin: ORIGIN,
      namespace: "eip155",
      chainRef: "eip155:1",
      createdAt: 1000,
      payload: { suggestedAccounts: ["0xabc"] },
    };

    const promise = controller.requestApproval(task, {
      transport: "provider",
      portId: "p1",
      sessionId: SESSION_ID,
      requestId: "1",
      origin: ORIGIN,
    });

    expect(controller.getState().pending.some((item) => item.id === id)).toBe(true);

    const value = ["0xabc"];
    await controller.resolve(id, async () => value);

    await expect(promise).resolves.toEqual(value);
    expect(controller.getState().pending.some((item) => item.id === id)).toBe(false);
  });

  it("allows synchronous onRequest handlers to resolve without races", async () => {
    const messenger = new ControllerMessenger<ApprovalMessengerTopics>({});
    const controller = new InMemoryApprovalController({ messenger });

    const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const task: ApprovalTask = {
      id,
      type: "wallet_requestAccounts",
      origin: ORIGIN,
      namespace: "eip155",
      chainRef: "eip155:1",
      createdAt: 1000,
      payload: { suggestedAccounts: ["0xabc"] },
    };

    const value = ["0xabc"];
    const unsubscribe = controller.onRequest(({ task: requested }) => {
      void controller.resolve(requested.id, async () => value);
    });

    try {
      const promise = controller.requestApproval(task, {
        transport: "provider",
        portId: "p1",
        sessionId: SESSION_ID,
        requestId: "1",
        origin: ORIGIN,
      });
      await expect(promise).resolves.toEqual(value);
    } finally {
      unsubscribe();
    }
  });

  it("expirePendingByRequestContext() rejects matching approvals and removes them from state", async () => {
    const messenger = new ControllerMessenger<ApprovalMessengerTopics>({});
    const controller = new InMemoryApprovalController({ messenger });

    const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const task: ApprovalTask = {
      id,
      type: "wallet_requestAccounts",
      origin: ORIGIN,
      namespace: "eip155",
      chainRef: "eip155:1",
      createdAt: 1000,
      payload: { suggestedAccounts: ["0xabc"] },
    };

    const p = controller.requestApproval(task, {
      transport: "provider",
      portId: "p1",
      sessionId: SESSION_ID,
      requestId: "1",
      origin: ORIGIN,
    });

    expect(controller.getState().pending.some((item) => item.id === id)).toBe(true);

    const count = await controller.expirePendingByRequestContext({ portId: "p1", sessionId: SESSION_ID });
    expect(count).toBe(1);
    expect(controller.getState().pending.some((item) => item.id === id)).toBe(false);

    await expect(p).rejects.toBeInstanceOf(Error);
  });

  it("reject() preserves caller-provided Error instance", async () => {
    const messenger = new ControllerMessenger<ApprovalMessengerTopics>({});
    const controller = new InMemoryApprovalController({ messenger });

    const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const task: ApprovalTask = {
      id,
      type: "wallet_requestAccounts",
      origin: ORIGIN,
      namespace: "eip155",
      chainRef: "eip155:1",
      createdAt: 1000,
      payload: { suggestedAccounts: ["0xabc"] },
    };

    const promise = controller.requestApproval(task, {
      transport: "provider",
      portId: "p1",
      sessionId: SESSION_ID,
      requestId: "1",
      origin: ORIGIN,
    });

    const custom = new Error("custom rejection");
    (custom as Error & { code?: number }).code = 4001;

    controller.reject(id, custom);
    await expect(promise).rejects.toBe(custom);
  });

  it("expires approvals after ttlMs to avoid hanging requests", async () => {
    vi.useFakeTimers();
    const messenger = new ControllerMessenger<ApprovalMessengerTopics>({});
    const controller = new InMemoryApprovalController({ messenger, ttlMs: 1_000 });

    const id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const task: ApprovalTask = {
      id,
      type: "wallet_requestAccounts",
      origin: ORIGIN,
      namespace: "eip155",
      chainRef: "eip155:1",
      createdAt: 1000,
      payload: { suggestedAccounts: ["0xabc"] },
    };

    const p = controller.requestApproval(task, {
      transport: "provider",
      portId: "p1",
      sessionId: SESSION_ID,
      requestId: "1",
      origin: ORIGIN,
    });

    expect(controller.getState().pending.some((item) => item.id === id)).toBe(true);

    vi.advanceTimersByTime(1_000);

    await expect(p).rejects.toBeInstanceOf(Error);
    expect(controller.getState().pending.some((item) => item.id === id)).toBe(false);
  });
});
