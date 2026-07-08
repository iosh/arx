import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultAccountId,
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

type RandomUuid = ReturnType<typeof crypto.randomUUID>;

const mockTransactionIds = () => {
  let nextId = 0;
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
    nextId += 1;
    return `tx-${nextId}` as RandomUuid;
  });
};

type CreateApprovedTransactionInputOverrides = Omit<Partial<CreateApprovedTransactionInput>, "request"> & {
  request?: {
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
  accountId: overrides.accountId ?? createDefaultAccountId(),
  request: {
    payload: structuredClone(
      overrides.request?.payload ?? {
        from: DEFAULT_FROM,
        to: DEFAULT_TO,
        value: "0x1",
        data: "0x",
      },
    ),
  },
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
  conflictKey: overrides.conflictKey ?? null,
  resourceKey: overrides.resourceKey ?? null,
  replacement: overrides.replacement ?? null,
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
        if (query.accountId !== undefined && record.accountId !== query.accountId) return false;
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
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  mockTransactionIds();
  const storage = createInMemoryTransactionsStoragePort();

  return {
    store: new TransactionAggregateStore({
      transactionsPort: storage.port,
    }),
    storage,
    tick: (value: number) => {
      vi.setSystemTime(value);
    },
  };
};

const getActiveSubmissionId = (aggregate: TransactionAggregate): string => {
  expect(aggregate.record.activeSubmissionId).toEqual(expect.any(String));
  return aggregate.record.activeSubmissionId as string;
};

describe("TransactionAggregateStore", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("persists a newly created approved aggregate", async () => {
    const { store, storage } = createService();

    const created = await store.createApprovedTransaction(createApprovedTransactionInput());
    const stored = storage.readAggregate("tx-1");

    expect(created.record.status).toBe("submitting");
    expect(created.record.activeSubmissionId).toBe("tx-2");
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
    const submissionId = getActiveSubmissionId(stored);
    const seededStorage = createInMemoryTransactionsStoragePort([stored]);

    const freshProcess = new TransactionAggregateStore({
      transactionsPort: seededStorage.port,
    });

    const signing = await freshProcess.beginSubmissionSigning({
      transactionId: "tx-1",
      submissionId,
    });

    expect(signing.record.status).toBe("submitting");
    expect(signing.record.activeSubmissionId).toBe(submissionId);
    expect(signing.submissions).toEqual([
      expect.objectContaining({
        id: submissionId,
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

    const first = await store.createApprovedTransaction(createApprovedTransactionInput());
    const firstSubmissionId = getActiveSubmissionId(first);
    await store.beginSubmissionSigning({
      transactionId: first.record.id,
      submissionId: firstSubmissionId,
    });

    tick(2_000);
    const second = await store.createApprovedTransaction(createApprovedTransactionInput());
    const secondSubmissionId = getActiveSubmissionId(second);
    await store.beginSubmissionSigning({
      transactionId: second.record.id,
      submissionId: secondSubmissionId,
    });
    await store.queueSubmissionBroadcast({
      transactionId: second.record.id,
      submissionId: secondSubmissionId,
    });
    await store.recordBroadcastAcceptance({
      transactionId: second.record.id,
      submissionId: secondSubmissionId,
      submitted: { hash: "0x2222" },
    });

    await store.failTransaction({
      transactionId: first.record.id,
      reason: buildTransactionTerminalReason({ kind: "internal_failed" }),
    });
    const third = await store.createApprovedTransaction(createApprovedTransactionInput());
    const thirdSubmissionId = getActiveSubmissionId(third);
    await store.beginSubmissionSigning({
      transactionId: third.record.id,
      submissionId: thirdSubmissionId,
    });

    const actions = await store.listRestartActions();

    expect(actions).toEqual([
      {
        kind: "finalize_incomplete_local",
        transactionId: third.record.id,
        targetStatus: "failed",
        reason: expect.objectContaining({
          kind: "broadcast_outcome_unknown",
        }),
      },
    ]);
  });
});
