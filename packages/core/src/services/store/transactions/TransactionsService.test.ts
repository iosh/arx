import { describe, expect, it } from "vitest";
import { type TransactionRecord, TransactionRecordSchema } from "../../../storage/records.js";
import type { TransactionsPort } from "./port.js";
import { createTransactionsService } from "./TransactionsService.js";
import type { TransactionRecordConflictError } from "./types.js";

const createInMemoryPort = (seed: TransactionRecord[] = []) => {
  const store = new Map<string, TransactionRecord>(seed.map((record) => [record.id, record]));

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
      if (chainRef) all = all.filter((record) => record.chainRef === chainRef);
      if (status) all = all.filter((record) => record.status === status);
      all.sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
      if (before !== undefined) {
        all = all.filter(
          (record) =>
            record.createdAt < before.createdAt ||
            (record.createdAt === before.createdAt && record.id.localeCompare(before.id) < 0),
        );
      }

      return all.slice(0, limit);
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

const createSubmittedRecord = (
  overrides: Partial<TransactionRecord> & Pick<TransactionRecord, "id" | "status" | "submitted">,
): TransactionRecord =>
  TransactionRecordSchema.parse({
    id: overrides.id,
    chainRef: "eip155:1",
    origin: "https://dapp.example",
    fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    status: overrides.status,
    submitted: overrides.submitted,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  });

describe("TransactionsService", () => {
  it("createSubmitted() writes a durable submitted record and emits changed once", async () => {
    const { port } = createInMemoryPort();
    const service = createTransactionsService({ port, now: () => 1_000 });

    let changed = 0;
    service.subscribeChanged(() => {
      changed += 1;
    });

    const created = await service.createSubmitted({
      id: "11111111-1111-4111-8111-111111111111",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "broadcast",
      submitted: {
        hash: "0x1111",
        chainId: "0x1",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        nonce: "0x7",
      },
    });

    expect(created.status).toBe("broadcast");
    expect(created.submitted).toEqual({
      hash: "0x1111",
      chainId: "0x1",
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nonce: "0x7",
    });
    expect(created.createdAt).toBe(1_000);
    expect(created.updatedAt).toBe(1_000);
    expect(changed).toBe(1);
  });

  it("createSubmitted() rejects submitted payloads that do not match the active namespace schema", async () => {
    const { port } = createInMemoryPort();
    const service = createTransactionsService({ port, now: () => 1_000 });

    await expect(
      service.createSubmitted({
        id: "22222222-2222-4222-8222-222222222222",
        chainRef: "eip155:1",
        origin: "https://dapp.example",
        fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "broadcast",
        submitted: {
          txHash: "request-1",
          memo: "delegate",
        } as never,
      }),
    ).rejects.toThrow(/submitted/i);
  });

  it("createSubmitted() returns the existing record for repeated submissions with the same id and submitted payload", async () => {
    const { port } = createInMemoryPort([
      createSubmittedRecord({
        id: "33333333-3333-4333-8333-333333333333",
        status: "broadcast",
        submitted: {
          hash: "0x3333",
          chainId: "0x1",
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          nonce: "0x7",
        },
      }),
    ]);
    const service = createTransactionsService({ port, now: () => 2_000 });

    await expect(
      service.createSubmitted({
        id: "33333333-3333-4333-8333-333333333333",
        chainRef: "eip155:1",
        origin: "https://dapp.example",
        fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "broadcast",
        submitted: {
          hash: "0x3333",
          chainId: "0x1",
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          nonce: "0x7",
        },
      }),
    ).resolves.toMatchObject({
      id: "33333333-3333-4333-8333-333333333333",
      submitted: {
        hash: "0x3333",
      },
    });
  });

  it("createSubmitted() rejects conflicting repeated submissions for the same id", async () => {
    const { port } = createInMemoryPort([
      createSubmittedRecord({
        id: "44444444-4444-4444-8444-444444444444",
        status: "broadcast",
        submitted: {
          hash: "0xaaaa",
          chainId: "0x1",
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          nonce: "0x7",
        },
      }),
    ]);
    const service = createTransactionsService({ port, now: () => 2_000 });

    await expect(
      service.createSubmitted({
        id: "44444444-4444-4444-8444-444444444444",
        chainRef: "eip155:1",
        origin: "https://dapp.example",
        fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "broadcast",
        submitted: {
          hash: "0xbbbb",
          chainId: "0x1",
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          nonce: "0x8",
        },
      }),
    ).rejects.toMatchObject({
      name: "TransactionRecordConflictError",
      conflict: { kind: "id", id: "44444444-4444-4444-8444-444444444444" },
    } satisfies Partial<TransactionRecordConflictError>);
  });

  it("transition() throws on invalid status transitions", async () => {
    const { port } = createInMemoryPort();
    const service = createTransactionsService({ port, now: () => 1_000 });

    const tx = await service.createSubmitted({
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "broadcast",
      submitted: {
        hash: "0x7777",
        chainId: "0x1",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        nonce: "0x7",
      },
    });

    await expect(
      service.transition({
        id: tx.id,
        fromStatus: "broadcast",
        toStatus: "broadcast",
      }),
    ).rejects.toThrow(/Invalid transaction status transition/);
  });

  it("transition() returns null on CAS mismatch (no changed event)", async () => {
    const { port } = createInMemoryPort();
    const service = createTransactionsService({ port, now: () => 1_000 });

    const tx = await service.createSubmitted({
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "broadcast",
      submitted: {
        hash: "0x8888",
        chainId: "0x1",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        nonce: "0x7",
      },
    });

    let changed = 0;
    service.subscribeChanged(() => {
      changed += 1;
    });

    const out = await service.transition({
      id: tx.id,
      fromStatus: "confirmed",
      toStatus: "failed",
    });

    expect(out).toBeNull();
    expect(changed).toBe(0);
  });

  it("transition() supports broadcast -> confirmed updates with receipt", async () => {
    const { port } = createInMemoryPort();
    const service = createTransactionsService({ port, now: () => 2_000 });

    const tx = await service.createSubmitted({
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "broadcast",
      submitted: {
        hash: "0x9999",
        chainId: "0x1",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        nonce: "0x7",
      },
    });

    const updated = await service.transition({
      id: tx.id,
      fromStatus: "broadcast",
      toStatus: "confirmed",
      patch: {
        receipt: {
          status: "0x1",
          blockNumber: "0x10",
        },
      },
    });

    expect(updated).toMatchObject({
      id: tx.id,
      status: "confirmed",
      submitted: {
        hash: "0x9999",
      },
      receipt: {
        status: "0x1",
        blockNumber: "0x10",
      },
      updatedAt: 2_000,
    });
  });

  it("patchIfStatus() patches replacement relation without changing status", async () => {
    const { port } = createInMemoryPort([
      createSubmittedRecord({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "replaced",
        submitted: {
          hash: "0xaaaa",
          chainId: "0x1",
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          nonce: "0x7",
        },
      }),
    ]);
    const service = createTransactionsService({ port, now: () => 2_000 });

    const updated = await service.patchIfStatus({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expectedStatus: "replaced",
      patch: { replacedId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    });

    expect(updated).toMatchObject({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "replaced",
      replacedId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      updatedAt: 2_000,
    });
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

    const service = createTransactionsService({ port: basePort, now: () => 1_000 });

    const tx = await service.createSubmitted({
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "broadcast",
      submitted: {
        hash: "0x1212",
        chainId: "0x1",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        nonce: "0x7",
      },
    });

    let changed = 0;
    service.subscribeChanged(() => {
      changed += 1;
    });

    const out = await service.transition({
      id: tx.id,
      fromStatus: "broadcast",
      toStatus: "failed",
    });

    expect(out).toBeNull();
    expect(changed).toBe(0);
  });

  it("remove() deletes the record and emits changed", async () => {
    const { port, store } = createInMemoryPort([
      createSubmittedRecord({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        status: "broadcast",
        submitted: {
          hash: "0xcccc",
          chainId: "0x1",
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          nonce: "0x7",
        },
      }),
    ]);
    const service = createTransactionsService({ port, now: () => 1_000 });

    let payloads = 0;
    service.subscribeChanged(() => {
      payloads += 1;
    });

    await service.remove("cccccccc-cccc-4ccc-8ccc-cccccccccccc");

    expect(store.has("cccccccc-cccc-4ccc-8ccc-cccccccccccc")).toBe(false);
    expect(payloads).toBe(1);
  });
});
