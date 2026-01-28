import { describe, expect, it } from "vitest";
import { type ApprovalRecord, ApprovalRecordSchema } from "../../db/records.js";
import { createApprovalsService } from "./ApprovalsService.js";
import type { ApprovalsPort } from "./port.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const createInMemoryPort = (seed: ApprovalRecord[] = []) => {
  const store = new Map<string, ApprovalRecord>(seed.map((r) => [r.id, r]));
  const writes: ApprovalRecord[] = [];

  const port: ApprovalsPort = {
    async get(id) {
      return store.get(id) ?? null;
    },
    async listPending() {
      return [...store.values()].filter((r) => r.status === "pending");
    },
    async upsert(record) {
      const checked = ApprovalRecordSchema.parse(record);
      store.set(checked.id, checked);
      writes.push(checked);
    },
  };

  return { port, store, writes };
};

describe("ApprovalsService", () => {
  it("create() writes a pending record and emits changed once", async () => {
    const { port, writes } = createInMemoryPort();
    let changed = 0;

    const service = createApprovalsService({
      port,
      now: () => 1000,
    });

    service.on("changed", () => {
      changed += 1;
    });

    const created = await service.create({
      type: "wallet_requestAccounts",
      origin: "https://dapp.example",
      namespace: "eip155",
      chainRef: "eip155:1",
      payload: { any: "value" },
      requestContext: {
        transport: "provider",
        portId: "p1",
        sessionId: SESSION_ID,
        requestId: "1",
        origin: "https://dapp.example",
      },
      expiresAt: 2000,
    });

    expect(ApprovalRecordSchema.parse(created).status).toBe("pending");
    expect(writes.length).toBe(1);
    expect(changed).toBe(1);
  });

  it("finalize() transitions pending -> approved and emits changed once", async () => {
    const { port } = createInMemoryPort();
    const service = createApprovalsService({ port, now: () => 1000 });

    const created = await service.create({
      type: "wallet_requestAccounts",
      origin: "https://dapp.example",
      payload: {},
      requestContext: {
        transport: "provider",
        portId: "p1",
        sessionId: SESSION_ID,
        requestId: "1",
        origin: "https://dapp.example",
      },
      expiresAt: 2000,
    });

    let changed = 0;
    service.on("changed", () => {
      changed += 1;
    });

    const finalized = await service.finalize({
      id: created.id,
      status: "approved",
      result: { ok: true },
      finalStatusReason: "user_approve",
    });

    expect(finalized).not.toBeNull();
    expect(ApprovalRecordSchema.parse(finalized!).status).toBe("approved");
    expect(changed).toBe(1);
  });

  it("finalize() does not emit changed when record is already finalized", async () => {
    const { port } = createInMemoryPort();
    const service = createApprovalsService({ port, now: () => 1000 });

    const created = await service.create({
      type: "wallet_requestAccounts",
      origin: "https://dapp.example",
      payload: {},
      requestContext: {
        transport: "provider",
        portId: "p1",
        sessionId: SESSION_ID,
        requestId: "1",
        origin: "https://dapp.example",
      },
      expiresAt: 2000,
    });

    await service.finalize({
      id: created.id,
      status: "rejected",
      finalStatusReason: "user_reject",
    });

    let changed = 0;
    service.on("changed", () => {
      changed += 1;
    });

    const again = await service.finalize({
      id: created.id,
      status: "approved",
      finalStatusReason: "user_approve",
    });

    expect(again?.status).toBe("rejected");
    expect(changed).toBe(0);
  });

  it("expireAllPending() expires all pending and emits changed once", async () => {
    const { port } = createInMemoryPort();
    const service = createApprovalsService({ port, now: () => 1000 });

    await service.create({
      type: "wallet_requestAccounts",
      origin: "https://dapp.example",
      payload: {},
      requestContext: {
        transport: "provider",
        portId: "p1",
        sessionId: SESSION_ID,
        requestId: "1",
        origin: "https://dapp.example",
      },
      expiresAt: 2000,
    });

    let changed = 0;
    service.on("changed", () => {
      changed += 1;
    });

    const count = await service.expireAllPending({ finalStatusReason: "session_lost" });

    expect(count).toBe(1);
    expect(changed).toBe(1);

    const pending = await service.listPending();
    expect(pending.length).toBe(0);
  });

  it("expireAllPending() does not emit changed when there are no pending approvals", async () => {
    const { port } = createInMemoryPort();
    const service = createApprovalsService({ port, now: () => 1000 });

    let changed = 0;
    service.on("changed", () => {
      changed += 1;
    });

    const count = await service.expireAllPending({ finalStatusReason: "session_lost" });

    expect(count).toBe(0);
    expect(changed).toBe(0);
  });
});
