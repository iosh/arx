import { describe, expect, it } from "vitest";
import {
  createDefaultAccountKey,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  DEFAULT_TO,
} from "../__fixtures__/transactionServices.js";
import {
  buildTransactionTerminalReason,
  type CreateApprovedTransactionInput,
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

type CreateApprovedTransactionInputOverrides = Omit<Partial<CreateApprovedTransactionInput>, "request"> & {
  request?: {
    kind?: CreateApprovedTransactionInput["request"]["kind"];
    payload?: JsonValue;
  };
};

const createApprovedTransactionInput = (
  overrides: CreateApprovedTransactionInputOverrides = {},
): CreateApprovedTransactionInput => ({
  namespace: overrides.namespace ?? "eip155",
  chainRef: overrides.chainRef ?? DEFAULT_CHAIN_REF,
  origin: overrides.origin ?? "https://dapp.example",
  source: overrides.source ?? "provider",
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
  approvalId: overrides.approvalId ?? "approval-1",
  approvedAt: overrides.approvedAt ?? null,
  approvedRequestPayload:
    overrides.approvedRequestPayload ??
    structuredClone({
      chainId: "0xa",
      from: DEFAULT_FROM,
      to: DEFAULT_TO,
      value: "0x1",
      data: "0x",
      gas: "0x5208",
      nonce: "0x7",
      type: "legacy",
      gasPrice: "0x3b9aca00",
    }),
  submissionId: overrides.submissionId ?? "submission-1",
  conflictKey: overrides.conflictKey ?? null,
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
    async insertApprovedTransactionAggregate({ aggregate }) {
      await port.insertTransactionAggregate(aggregate);
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
        .filter((aggregate) => ["submitting", "submitted"].includes(aggregate.record.status))
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
  it("persists a newly created approved aggregate", async () => {
    const { store, storage } = createService();

    const created = await store.createApprovedTransaction(createApprovedTransactionInput());
    const stored = storage.readAggregate("tx-1");

    expect(created.record.status).toBe("submitting");
    expect(created.record.approvedRequest?.approvalId).toBe("approval-1");
    expect(created.record.activeSubmissionId).toBe("submission-1");
    expect(stored).toEqual(created);
  });

  it("hydrates a stored aggregate before mutating and saving it", async () => {
    const { store, tick } = createService();

    await store.createApprovedTransaction(createApprovedTransactionInput());
    tick(2_000);

    const stored = await store.loadTransactionAggregate("tx-1");
    if (!stored) {
      throw new Error("Expected stored aggregate to exist.");
    }
    const seededStorage = createInMemoryTransactionsStoragePort([stored]);

    const freshProcess = new TransactionAggregateStore({
      storage: seededStorage.port,
      now: () => 2_000,
      createId: () => "unused-id",
    });

    const signing = await freshProcess.beginSubmissionSigning({
      transactionId: "tx-1",
      submissionId: "submission-1",
    });

    expect(signing.record.status).toBe("submitting");
    expect(signing.record.activeSubmissionId).toBe("submission-1");
    expect(signing.submissions).toEqual([
      expect.objectContaining({
        id: "submission-1",
        status: "signing",
      }),
    ]);
    expect(seededStorage.readAggregate("tx-1")).toEqual(signing);
  });

  it("rethrows aggregate not-found when mutating a missing stored transaction", async () => {
    const { store } = createService();

    await expect(store.cancelTransaction({ transactionId: "missing", reason: null })).rejects.toThrow(
      TransactionAggregateNotFoundError,
    );
  });

  it("lists restart actions from recoverable aggregates only", async () => {
    const { store, tick } = createService();

    await store.createApprovedTransaction(createApprovedTransactionInput());
    await store.beginSubmissionSigning({
      transactionId: "tx-1",
      submissionId: "submission-1",
    });

    tick(2_000);
    await store.createApprovedTransaction(
      createApprovedTransactionInput({
        requestId: "request-2",
        approvalId: "approval-2",
        submissionId: "submission-2",
      }),
    );
    await store.beginSubmissionSigning({
      transactionId: "tx-2",
      submissionId: "submission-2",
    });
    await store.queueSubmissionBroadcast({
      transactionId: "tx-2",
      submissionId: "submission-2",
    });
    await store.recordBroadcastAcceptance({
      transactionId: "tx-2",
      submissionId: "submission-2",
      submitted: { hash: "0x2222" },
    });

    await store.failTransaction({
      transactionId: "tx-1",
      reason: buildTransactionTerminalReason({ kind: "internal_failed" }),
    });
    await store.createApprovedTransaction(
      createApprovedTransactionInput({
        requestId: "request-3",
        approvalId: "approval-3",
        submissionId: "submission-3",
      }),
    );
    await store.beginSubmissionSigning({
      transactionId: "tx-3",
      submissionId: "submission-3",
    });

    const actions = await store.listRestartActions();

    expect(actions).toEqual([
      {
        kind: "finalize_incomplete_local",
        transactionId: "tx-3",
        targetStatus: "failed",
        reason: expect.objectContaining({
          kind: "broadcast_outcome_unknown",
        }),
      },
      {
        kind: "resume_tracking",
        transactionId: "tx-2",
      },
    ]);
  });
});
