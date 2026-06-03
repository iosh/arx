import { describe, expect, it } from "vitest";
import {
  createDefaultAccountKey,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  DEFAULT_TO,
} from "../__fixtures__/transactionServices.js";
import {
  type CreateTransactionInput,
  type JsonValue,
  type ListRecoverableTransactionAggregatesQuery,
  type ListTransactionHistoryQuery,
  type TransactionAggregate,
  TransactionAggregateNotFoundError,
  type TransactionConflictKey,
  type TransactionRecord,
  type TransactionsStoragePort,
} from "./index.js";
import { TransactionAggregateStore } from "./TransactionAggregateStore.js";

const cloneAggregate = (aggregate: TransactionAggregate): TransactionAggregate => structuredClone(aggregate);

const compareRecordsNewestFirst = (left: TransactionRecord, right: TransactionRecord): number =>
  right.createdAt - left.createdAt || right.id.localeCompare(left.id);

type CreateTransactionInputOverrides = Omit<Partial<CreateTransactionInput>, "request"> & {
  request?: {
    kind?: CreateTransactionInput["request"]["kind"];
    payload?: JsonValue;
  };
};

const createTransactionInput = (overrides: CreateTransactionInputOverrides = {}): CreateTransactionInput => ({
  namespace: overrides.namespace ?? "eip155",
  chainRef: overrides.chainRef ?? DEFAULT_CHAIN_REF,
  origin: overrides.origin ?? "https://dapp.example",
  source: overrides.source ?? "dapp",
  requestId: overrides.requestId ?? "request-1",
  accountKey: overrides.accountKey ?? createDefaultAccountKey(),
  request: {
    kind: overrides.request?.kind ?? "eip155.rpc.eth_sendTransaction",
    payload: structuredClone(
      overrides.request?.payload ?? {
        from: DEFAULT_FROM,
        to: DEFAULT_TO,
        value: "0x1",
        data: "0x",
      },
    ),
  },
  ...(overrides.replacement !== undefined ? { replacement: overrides.replacement } : {}),
});

const createInMemoryTransactionsStoragePort = (
  seed: TransactionAggregate[] = [],
): {
  port: TransactionsStoragePort;
  readAggregate(transactionId: string): TransactionAggregate | null;
} => {
  const store = new Map<string, TransactionAggregate>();

  for (const aggregate of seed) {
    store.set(aggregate.record.id, cloneAggregate(aggregate));
  }

  const readAggregate = (transactionId: string) => {
    const aggregate = store.get(transactionId);
    return aggregate ? cloneAggregate(aggregate) : null;
  };

  const port: TransactionsStoragePort = {
    async loadTransactionAggregate(transactionId) {
      return readAggregate(transactionId);
    },
    async insertTransactionAggregate(aggregate) {
      const transactionId = aggregate.record.id;
      if (store.has(transactionId)) {
        throw new Error(`Duplicate aggregate "${transactionId}"`);
      }
      store.set(transactionId, cloneAggregate(aggregate));
    },
    async saveTransactionAggregate(aggregate) {
      const transactionId = aggregate.record.id;
      if (!store.has(transactionId)) {
        throw new Error(`Missing aggregate "${transactionId}"`);
      }
      store.set(transactionId, cloneAggregate(aggregate));
    },
    async commitApprovedTransactionAggregate({ aggregate }) {
      await port.saveTransactionAggregate(aggregate);
    },
    async listTransactionHistory(query: ListTransactionHistoryQuery = {}) {
      const records = [...store.values()].map((aggregate) => structuredClone(aggregate.record));
      const filtered = records.filter((record) => {
        if (query.namespace !== undefined && record.namespace !== query.namespace) return false;
        if (query.chainRef !== undefined && record.chainRef !== query.chainRef) return false;
        if (query.accountKey !== undefined && record.accountKey !== query.accountKey) return false;
        if (query.status !== undefined && record.status !== query.status) return false;
        if (
          query.before !== undefined &&
          !(
            record.createdAt < query.before.createdAt ||
            (record.createdAt === query.before.createdAt && record.id.localeCompare(query.before.id) < 0)
          )
        ) {
          return false;
        }
        return true;
      });
      filtered.sort(compareRecordsNewestFirst);
      return filtered.slice(0, query.limit ?? filtered.length);
    },
    async findTransactionRecordsByConflictKey(key: TransactionConflictKey) {
      const records = [...store.values()]
        .map((aggregate) => structuredClone(aggregate.record))
        .filter((record) => record.conflictKey?.kind === key.kind && record.conflictKey.value === key.value);
      records.sort(compareRecordsNewestFirst);
      return records;
    },
    async listRecoverableTransactionAggregates(query: ListRecoverableTransactionAggregatesQuery = {}) {
      const aggregates = [...store.values()]
        .filter((aggregate) => ["awaiting_approval", "submitting", "submitted"].includes(aggregate.record.status))
        .map((aggregate) => cloneAggregate(aggregate))
        .sort((left, right) => compareRecordsNewestFirst(left.record, right.record));
      return aggregates.slice(0, query.limit ?? aggregates.length);
    },
  };

  return {
    port,
    readAggregate,
  };
};

const createService = () => {
  let now = 1_000;
  let nextId = 0;
  const storage = createInMemoryTransactionsStoragePort();

  return {
    store: new TransactionAggregateStore({
      storage: storage.port,
      now: () => now,
      createId: () => {
        nextId += 1;
        return `tx-${nextId}`;
      },
    }),
    storage,
    tick: (value: number) => {
      now = value;
    },
  };
};

describe("TransactionAggregateStore", () => {
  it("persists a newly created awaiting-approval aggregate", async () => {
    const { store, storage } = createService();

    const created = await store.createTransaction(createTransactionInput());
    const stored = storage.readAggregate("tx-1");

    expect(created.record.status).toBe("awaiting_approval");
    expect(stored).toEqual(created);
  });

  it("hydrates a stored aggregate before approving and saving the queued submission", async () => {
    const { store, tick } = createService();

    await store.createTransaction(createTransactionInput());
    tick(2_000);

    const stored = await store.loadTransactionAggregate("tx-1");
    if (!stored) {
      throw new Error("Expected stored aggregate to exist.");
    }
    const seededStorage = createInMemoryTransactionsStoragePort([stored]);

    const freshProcess = new TransactionAggregateStore({
      storage: seededStorage.port,
      now: () => 2_000,
      createId: () => "submission-1",
    });

    const approved = await freshProcess.approveTransaction({
      transactionId: "tx-1",
      approvalId: "approval-1",
      approvedAt: null,
      submissionId: null,
      approvedRequestPayload: {
        chainId: "0xa",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        value: "0x1",
        data: "0x",
        gas: "0x5208",
        nonce: "0x7",
        type: "legacy",
        gasPrice: "0x3b9aca00",
      },
      conflictKey: {
        kind: "eip155.nonce",
        value: "eip155:10:eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0x7",
      },
    });

    expect(approved.record.status).toBe("submitting");
    expect(approved.record.approvedRequest?.approvalId).toBe("approval-1");
    expect(approved.record.activeSubmissionId).toBe("submission-1");
    expect(approved.submissions).toEqual([
      expect.objectContaining({
        id: "submission-1",
        status: "queued",
      }),
    ]);
    expect(seededStorage.readAggregate("tx-1")).toEqual(approved);
  });

  it("rethrows aggregate not-found when mutating a missing stored transaction", async () => {
    const { store } = createService();

    await expect(store.rejectTransaction({ transactionId: "missing", reason: null })).rejects.toThrow(
      TransactionAggregateNotFoundError,
    );
  });

  it("lists restart actions from recoverable aggregates only", async () => {
    const { store, tick } = createService();

    await store.createTransaction(createTransactionInput());
    tick(2_000);
    await store.createTransaction(createTransactionInput({ requestId: "request-2" }));
    await store.approveTransaction({
      transactionId: "tx-2",
      approvalId: "approval-2",
      approvedAt: null,
      submissionId: "submission-2",
      approvedRequestPayload: {
        chainId: "0xa",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        value: "0x1",
        data: "0x",
        gas: "0x5208",
        nonce: "0x8",
        type: "legacy",
        gasPrice: "0x3b9aca00",
      },
      conflictKey: null,
    });

    const actions = await store.listRestartActions();

    expect(actions).toEqual([
      expect.objectContaining({
        kind: "finalize_incomplete_local",
        transactionId: "tx-2",
        targetStatus: "failed",
      }),
      expect.objectContaining({
        kind: "finalize_incomplete_local",
        transactionId: "tx-1",
        targetStatus: "cancelled",
      }),
    ]);
  });
});
