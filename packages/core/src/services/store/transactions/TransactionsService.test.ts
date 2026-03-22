import { describe, expect, it } from "vitest";
import { type TransactionRecord, TransactionRecordSchema } from "../../../storage/records.js";
import type { TransactionsPort } from "./port.js";
import { createTransactionsService } from "./TransactionsService.js";

const createInMemoryPort = (seed: TransactionRecord[] = []) => {
  const store = new Map<string, TransactionRecord>(seed.map((r) => [r.id, r]));

  const port: TransactionsPort = {
    async get(id) {
      return store.get(id) ?? null;
    },
    async list(query) {
      const chainRef = query?.chainRef;
      const status = query?.status;
      const limit = query?.limit ?? 100;
      const before = query?.before;

      let all = [...store.values()];
      if (chainRef) all = all.filter((r) => r.chainRef === chainRef);
      if (status) all = all.filter((r) => r.status === status);
      all.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
      if (before !== undefined) {
        all = all.filter(
          (r) =>
            r.createdAt < before.createdAt || (r.createdAt === before.createdAt && r.id.localeCompare(before.id) < 0),
        );
      }

      return all.slice(0, limit);
    },
    async findByChainRefAndHash(params) {
      for (const r of store.values()) {
        if (r.chainRef === params.chainRef && r.hash === params.hash) return r;
      }
      return null;
    },
    async create(record) {
      const checked = TransactionRecordSchema.parse(record);
      if (store.has(checked.id)) {
        throw new Error(`Duplicate transaction id "${checked.id}"`);
      }
      store.set(checked.id, checked);
    },
    async updateIfStatus(params) {
      const current = store.get(params.id);
      if (!current) return false;
      if (current.status !== params.expectedStatus) return false;

      const checked = TransactionRecordSchema.parse(params.next);
      store.set(checked.id, checked);
      return true;
    },
    async remove(id) {
      store.delete(id);
    },
  };

  return { port, store };
};

describe("TransactionsService", () => {
  it("createPending() writes a pending record and emits changed once", async () => {
    const { port } = createInMemoryPort();
    const service = createTransactionsService({ port, now: () => 1000 });

    let changed = 0;
    service.subscribeChanged(() => {
      changed += 1;
    });

    const created = await service.createPending({
      id: "11111111-1111-4111-8111-111111111111",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      request: { namespace: "eip155", chainRef: "eip155:1", payload: { chainId: "0x1" } },
    });

    expect(created.status).toBe("pending");
    expect(created.hash).toBeNull();
    expect(created.userRejected).toBe(false);
    expect(created.createdAt).toBe(1000);
    expect(created.updatedAt).toBe(1000);
    expect(changed).toBe(1);
  });

  it("createPending() accepts namespace-specific payloads without shared schema branches", async () => {
    const { port } = createInMemoryPort();
    const service = createTransactionsService({ port, now: () => 1000 });

    const created = await service.createPending({
      id: "22222222-2222-4222-8222-222222222222",
      namespace: "cosmos",
      chainRef: "cosmos:cosmoshub-4",
      origin: "https://dapp.example",
      fromAccountKey: "cosmos:aa",
      request: {
        namespace: "cosmos",
        chainRef: "cosmos:cosmoshub-4",
        payload: {
          memo: "delegate",
          fee: { amount: "2500", denom: "uatom" },
        },
      },
    });

    expect(created.request).toEqual({
      namespace: "cosmos",
      chainRef: "cosmos:cosmoshub-4",
      payload: {
        memo: "delegate",
        fee: { amount: "2500", denom: "uatom" },
      },
    });
  });

  it("createPending() writes the resolved chainRef into the stored request", async () => {
    const { port } = createInMemoryPort();
    const service = createTransactionsService({ port, now: () => 1000 });

    const created = await service.createPending({
      id: "33333333-3333-4333-8333-333333333333",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      request: {
        namespace: "eip155",
        payload: { chainId: "0x1" },
      },
    });

    expect(created.request.chainRef).toBe("eip155:1");
  });

  it("createPending() rejects duplicate ids instead of overwriting an existing record", async () => {
    const { port } = createInMemoryPort([
      TransactionRecordSchema.parse({
        id: "44444444-4444-4444-8444-444444444444",
        namespace: "eip155",
        chainRef: "eip155:1",
        origin: "https://dapp.example",
        fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "pending",
        request: {
          namespace: "eip155",
          chainRef: "eip155:1",
          payload: { chainId: "0x1" },
        },
        prepared: null,
        hash: null,
        userRejected: false,
        warnings: [],
        issues: [],
        createdAt: 1000,
        updatedAt: 1000,
      }),
    ]);
    const service = createTransactionsService({ port, now: () => 2000 });

    await expect(
      service.createPending({
        id: "44444444-4444-4444-8444-444444444444",
        namespace: "eip155",
        chainRef: "eip155:1",
        origin: "https://dapp.example",
        fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        request: {
          namespace: "eip155",
          payload: { chainId: "0x1" },
        },
      }),
    ).rejects.toThrow(/duplicate transaction id/i);
  });

  it("transition() throws on invalid status transitions", async () => {
    const { port } = createInMemoryPort();
    const service = createTransactionsService({ port, now: () => 1000 });

    const tx = await service.createPending({
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      request: { namespace: "eip155", chainRef: "eip155:1", payload: { chainId: "0x1" } },
    });

    await expect(
      service.transition({
        id: tx.id,
        fromStatus: "pending",
        toStatus: "broadcast",
      }),
    ).rejects.toThrow(/Invalid transaction status transition/);
  });

  it("transition() returns null on CAS mismatch (no changed event)", async () => {
    const { port } = createInMemoryPort();
    const service = createTransactionsService({ port, now: () => 1000 });

    const tx = await service.createPending({
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      request: { namespace: "eip155", chainRef: "eip155:1", payload: { chainId: "0x1" } },
    });

    let changed = 0;
    service.subscribeChanged(() => {
      changed += 1;
    });

    const out = await service.transition({
      id: tx.id,
      fromStatus: "approved",
      toStatus: "signed",
    });

    expect(out).toBeNull();
    expect(changed).toBe(0);
  });

  it("transition() requires hash when transitioning to broadcast/confirmed/replaced", async () => {
    const { port } = createInMemoryPort();
    const service = createTransactionsService({ port, now: () => 1000 });

    const tx = await service.createPending({
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      request: { namespace: "eip155", chainRef: "eip155:1", payload: { chainId: "0x1" } },
    });

    await service.transition({ id: tx.id, fromStatus: "pending", toStatus: "approved" });
    await service.transition({ id: tx.id, fromStatus: "approved", toStatus: "signed" });

    await expect(service.transition({ id: tx.id, fromStatus: "signed", toStatus: "broadcast" })).rejects.toThrow(
      /hash is required/i,
    );
  });

  it("transition() enforces (chainRef, hash) uniqueness (throws on duplicates)", async () => {
    const { port } = createInMemoryPort();
    const service = createTransactionsService({ port, now: () => 1000 });

    const t1 = await service.createPending({
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      request: { namespace: "eip155", chainRef: "eip155:1", payload: { chainId: "0x1" } },
    });

    await service.transition({ id: t1.id, fromStatus: "pending", toStatus: "approved" });
    await service.transition({ id: t1.id, fromStatus: "approved", toStatus: "signed" });
    await service.transition({
      id: t1.id,
      fromStatus: "signed",
      toStatus: "broadcast",
      patch: { hash: "txid-1" },
    });

    const t2 = await service.createPending({
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      request: { namespace: "eip155", chainRef: "eip155:1", payload: { chainId: "0x1" } },
    });

    await service.transition({ id: t2.id, fromStatus: "pending", toStatus: "approved" });
    await service.transition({ id: t2.id, fromStatus: "approved", toStatus: "signed" });

    await expect(
      service.transition({
        id: t2.id,
        fromStatus: "signed",
        toStatus: "broadcast",
        patch: { hash: "txid-1" },
      }),
    ).rejects.toThrow(/Duplicate transaction hash/i);
  });

  it("transition() returns null when port.updateIfStatus() fails (no changed event)", async () => {
    const { store } = createInMemoryPort();

    const basePort: TransactionsPort = {
      async get(id) {
        return store.get(id) ?? null;
      },
      async list() {
        return [];
      },
      async findByChainRefAndHash() {
        return null;
      },
      async create(record) {
        const checked = TransactionRecordSchema.parse(record);
        if (store.has(checked.id)) {
          throw new Error(`Duplicate transaction id "${checked.id}"`);
        }
        store.set(checked.id, checked);
      },
      async updateIfStatus() {
        return false;
      },
      async remove() {},
    };

    const service = createTransactionsService({ port: basePort, now: () => 1000 });

    const tx = await service.createPending({
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      request: { namespace: "eip155", chainRef: "eip155:1", payload: { chainId: "0x1" } },
    });

    let changed = 0;
    service.subscribeChanged(() => {
      changed += 1;
    });

    const out = await service.transition({
      id: tx.id,
      fromStatus: "pending",
      toStatus: "approved",
    });

    expect(out).toBeNull();
    expect(changed).toBe(0);
  });

  it("failAllPending() does not skip equal createdAt rows and preserves the reason-specific message", async () => {
    const createdAt = 1_000;
    const makeId = (index: number) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
    const seed = Array.from({ length: 201 }, (_, index) =>
      TransactionRecordSchema.parse({
        id: makeId(index),
        namespace: "eip155",
        chainRef: "eip155:1",
        origin: "https://dapp.example",
        fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "pending",
        request: { namespace: "eip155", chainRef: "eip155:1", payload: { chainId: "0x1" } },
        prepared: null,
        hash: null,
        userRejected: false,
        warnings: [],
        issues: [],
        createdAt,
        updatedAt: createdAt,
      }),
    );
    const { port, store } = createInMemoryPort(seed);
    const service = createTransactionsService({ port, now: () => 2_000 });

    const transitioned = await service.failAllPending({ reason: "session_lost" });

    expect(transitioned).toBe(201);
    expect(Array.from(store.values()).every((record) => record.status === "failed")).toBe(true);
    expect(
      Array.from(store.values()).every(
        (record) =>
          record.error?.name === "TransactionAbandonedError" &&
          record.error?.message === "Transaction was abandoned due to session loss." &&
          (record.error?.data as { reason?: string } | undefined)?.reason === "session_lost",
      ),
    ).toBe(true);
  });
});
