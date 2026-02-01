import { describe, expect, it, vi } from "vitest";
import { type ApprovalRecord, ApprovalRecordSchema } from "../../db/records.js";
import { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import { createApprovalsService } from "../../services/approvals/ApprovalsService.js";
import type { ApprovalsPort } from "../../services/approvals/port.js";
import { StoreApprovalController } from "./StoreApprovalController.js";
import type { ApprovalMessengerTopics, ApprovalTask } from "./types.js";

const ORIGIN = "https://dapp.example";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const createInMemoryPort = () => {
  const store = new Map<string, ApprovalRecord>();

  const port: ApprovalsPort = {
    async get(id) {
      return store.get(id) ?? null;
    },
    async listPending() {
      return [...store.values()].filter((record) => record.status === "pending");
    },
    async upsert(record) {
      const checked = ApprovalRecordSchema.parse(record);
      store.set(checked.id, checked);
    },
  };

  return { port, store };
};

describe("StoreApprovalController", () => {
  it("requestApproval() requires requestContext", async () => {
    const { port } = createInMemoryPort();
    const service = createApprovalsService({ port, now: () => 1000 });
    const messenger = new ControllerMessenger<ApprovalMessengerTopics>({});

    const controller = new StoreApprovalController({
      messenger,
      service,
      now: () => 1000,
      ttlMs: 10_000,
    });

    const task: ApprovalTask<{ any: string }> = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      type: "wallet_requestAccounts",
      origin: ORIGIN,
      namespace: "eip155",
      chainRef: "eip155:1",
      payload: { any: "value" },
      createdAt: 1000,
    };

    // @ts-expect-error - requestContext is required
    await expect(controller.requestApproval(task, null)).rejects.toThrow(/requestContext/i);
  });

  it("requestApproval() persists + resolve() finalizes + resolves the original promise", async () => {
    const { port, store } = createInMemoryPort();
    const service = createApprovalsService({ port, now: () => 1000 });
    const messenger = new ControllerMessenger<ApprovalMessengerTopics>({});

    const controller = new StoreApprovalController({
      messenger,
      service,
      now: () => 1000,
      ttlMs: 10_000,
    });

    const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const task: ApprovalTask<{ any: string }> = {
      id,
      type: "wallet_requestAccounts",
      origin: ORIGIN,
      namespace: "eip155",
      chainRef: "eip155:1",
      payload: { any: "value" },
      createdAt: 1000,
    };

    const promise = controller.requestApproval(task, {
      transport: "provider",
      portId: "p1",
      sessionId: SESSION_ID,
      requestId: "1",
      origin: ORIGIN,
    });

    await vi.waitFor(() => {
      expect(store.size).toBe(1);
      expect(controller.getState().pending.some((item) => item.id === id)).toBe(true);
    });

    const value = { ok: true };
    await controller.resolve(id, async () => value);

    await expect(promise).resolves.toEqual(value);

    const record = await service.get(id);
    expect(record?.status).toBe("approved");
  });
});
