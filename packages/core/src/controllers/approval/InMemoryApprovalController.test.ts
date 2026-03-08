import { afterEach, describe, expect, it, vi } from "vitest";
import { Messenger } from "../../messenger/Messenger.js";
import { InMemoryApprovalController } from "./InMemoryApprovalController.js";
import { APPROVAL_TOPICS } from "./topics.js";
import { type ApprovalCreateParams, ApprovalKinds } from "./types.js";

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
    request: { suggestedAccounts: ["0xabc"] },
    ...overrides,
  } satisfies ApprovalCreateParams<typeof ApprovalKinds.RequestAccounts>;
};

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

  it("create() enqueues + resolve(approve) finalizes + resolves the original promise", async () => {
    const messenger = new Messenger();
    const controller = new InMemoryApprovalController({ messenger: messenger.scope({ publish: APPROVAL_TOPICS }) });

    const request = createRequest({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    const handle = controller.create(request, requester);

    expect(controller.getState().pending.some((item) => item.id === request.id)).toBe(true);

    const value = ["0xabc"];
    await controller.resolve({ id: request.id, action: "approve", result: value });

    await expect(handle.settled).resolves.toEqual(value);
    expect(controller.getState().pending.some((item) => item.id === request.id)).toBe(false);
  });

  it("allows synchronous onCreated handlers to resolve without races", async () => {
    const messenger = new Messenger();
    const controller = new InMemoryApprovalController({ messenger: messenger.scope({ publish: APPROVAL_TOPICS }) });

    const request = createRequest({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
    const value = ["0xabc"];
    const unsubscribe = controller.onCreated(({ record }) => {
      void controller.resolve({ id: record.id, action: "approve", result: value });
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

    await expect(handle.settled).rejects.toBeInstanceOf(Error);
  });

  it("resolve(reject) preserves caller-provided Error instance", async () => {
    const messenger = new Messenger();
    const controller = new InMemoryApprovalController({ messenger: messenger.scope({ publish: APPROVAL_TOPICS }) });

    const request = createRequest({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" });
    const handle = controller.create(request, requester);

    const custom = new Error("custom rejection");
    (custom as Error & { code?: number }).code = 4001;

    await controller.resolve({ id: request.id, action: "reject", error: custom });
    await expect(handle.settled).rejects.toBe(custom);
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

    await expect(handle.settled).rejects.toBeInstanceOf(Error);
    expect(controller.getState().pending.some((item) => item.id === request.id)).toBe(false);
  });
});
