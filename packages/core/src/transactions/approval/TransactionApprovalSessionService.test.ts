import { describe, expect, it, vi } from "vitest";
import { eip155AddressCodec } from "../../chains/eip155/addressCodec.js";
import { ChainAddressCodecRegistry } from "../../chains/registry.js";
import type { Eip155RpcClient } from "../../rpc/namespaceClients/eip155.js";
import {
  accountCodecs,
  createDefaultAccountKey,
  createNamespaceTransactionStub,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  DEFAULT_TO,
  DEFAULT_UNSIGNED_TRANSACTION,
} from "../__fixtures__/transactionServices.js";
import type {
  CreateTransactionInput,
  JsonValue,
  ListRecoverableTransactionAggregatesQuery,
  ListTransactionHistoryQuery,
  TransactionAggregate,
  TransactionConflictKey,
  TransactionRecord,
  TransactionsStoragePort,
} from "../aggregate/index.js";
import { TransactionAggregateStore } from "../aggregate/TransactionAggregateStore.js";
import { createEip155Transaction } from "../namespace/eip155/transaction.js";
import { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import { TransactionApprovalSessionService } from "./TransactionApprovalSessionService.js";

const cloneAggregate = (aggregate: TransactionAggregate): TransactionAggregate => structuredClone(aggregate);

const compareRecordsNewestFirst = (left: TransactionRecord, right: TransactionRecord): number =>
  right.createdAt - left.createdAt || right.id.localeCompare(left.id);

const createTransactionInput = (
  overrides: Partial<CreateTransactionInput> & {
    request?: Partial<CreateTransactionInput["request"]> & {
      payload?: JsonValue;
    };
  } = {},
): CreateTransactionInput => ({
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

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const createEip155RpcClientStub = (): Eip155RpcClient => ({
  request: vi.fn(),
  estimateGas: vi.fn(async () => "0x5208"),
  getBalance: vi.fn(async () => "0xde0b6b3a7640000"),
  getTransactionCount: vi.fn(async () => "0x7"),
  getGasPrice: vi.fn(async () => "0x3b9aca00"),
  getMaxPriorityFeePerGas: vi.fn(async () => "0x3b9aca00"),
  getFeeHistory: vi.fn(async () => ({ oldestBlock: "0x1", baseFeePerGas: [], gasUsedRatio: [], reward: [] })),
  getBlockByNumber: vi.fn(async () => ({ baseFeePerGas: null })),
  getTransactionReceipt: vi.fn(async () => null),
  sendRawTransaction: vi.fn(async () => "0xhash"),
});

const createServices = (namespaces: NamespaceTransactions) => {
  let now = 1_000;
  let nextTransactionId = 0;
  let nextPrepareId = 0;
  const storage = createInMemoryTransactionsStoragePort();
  const transactionStore = new TransactionAggregateStore({
    storage: storage.port,
    now: () => now,
    createId: () => {
      nextTransactionId += 1;
      return `tx-${nextTransactionId}`;
    },
  });
  const sessions = new TransactionApprovalSessionService({
    transactions: transactionStore,
    namespaces,
    accountCodecs,
    now: () => now,
    createId: () => {
      nextPrepareId += 1;
      return `prepare-${nextPrepareId}`;
    },
  });

  return {
    transactionStore,
    sessions,
    tick: (value: number) => {
      now = value;
    },
  };
};

describe("TransactionApprovalSessionService", () => {
  it("opens an EIP-155 session, reapplies draft edits, and approves the exact prepared payload", async () => {
    const rpc = createEip155RpcClientStub();
    const namespaces = new NamespaceTransactions([
      [
        "eip155",
        createEip155Transaction({
          chains: new ChainAddressCodecRegistry([eip155AddressCodec]),
          rpcClientFactory: () => rpc,
          signer: { signTransaction: vi.fn() },
          broadcaster: { broadcast: vi.fn() },
        }),
      ],
    ]);
    const { transactionStore, sessions, tick } = createServices(namespaces);

    await transactionStore.createTransaction(createTransactionInput());

    const opened = await sessions.openSession({
      transactionId: "tx-1",
      approvalId: "approval-1",
    });

    expect(opened.prepare.status).toBe("ready");
    expect(opened.prepare.status === "ready" ? opened.prepare.approvedPayload : null).toMatchObject({
      nonce: "0x7",
      gas: "0x5208",
      gasPrice: "0x3b9aca00",
    });
    expect(opened.prepare.status === "ready" ? opened.prepare.review : null).toMatchObject({
      namespace: "eip155",
      kind: "native_transfer",
      gasLimit: "0x5208",
    });

    tick(2_000);
    const edited = await sessions.applyDraftEdit({
      transactionId: "tx-1",
      approvalId: "approval-1",
      edit: {
        namespace: "eip155",
        changes: [{ field: "nonce", value: "0x8" }],
      },
    });

    expect(edited.prepare.status).toBe("ready");
    expect(edited.prepare.status === "ready" ? edited.prepare.approvedPayload : null).toMatchObject({
      nonce: "0x8",
      gas: "0x5208",
    });

    tick(3_000);
    const approved = await sessions.approveTransaction({
      transactionId: "tx-1",
      approvalId: "approval-1",
    });

    expect(approved.record.status).toBe("submitting");
    expect(approved.record.approvedRequest).toMatchObject({
      approvalId: "approval-1",
      approvedAt: 3_000,
      payload: {
        nonce: "0x8",
        gas: "0x5208",
      },
    });
    expect(approved.record.conflictKey).toEqual({
      kind: "eip155.nonce",
      value: `${approved.record.chainRef}:${approved.record.accountKey}:0x8`,
    });
    expect(sessions.getSession("tx-1")).toBeNull();
  });

  it("delegates approved conflict key derivation to the namespace proposal", async () => {
    const deriveConflictKey = vi.fn(() => ({
      kind: "test.conflict",
      value: "tx-1",
    }));
    const namespaces = new NamespaceTransactions([
      [
        "eip155",
        createNamespaceTransactionStub({
          deriveConflictKey: deriveConflictKey as never,
        }),
      ],
    ]);
    const { transactionStore, sessions } = createServices(namespaces);

    await transactionStore.createTransaction(createTransactionInput());
    await sessions.openSession({
      transactionId: "tx-1",
      approvalId: "approval-1",
    });

    const approved = await sessions.approveTransaction({
      transactionId: "tx-1",
      approvalId: "approval-1",
    });

    expect(deriveConflictKey).toHaveBeenCalledWith({
      transactionId: "tx-1",
      namespace: "eip155",
      chainRef: DEFAULT_CHAIN_REF,
      origin: "https://dapp.example",
      accountKey: createDefaultAccountKey(),
      from: DEFAULT_FROM,
      request: {
        namespace: "eip155",
        chainRef: DEFAULT_CHAIN_REF,
        payload: {
          from: DEFAULT_FROM,
          to: DEFAULT_TO,
          value: "0x1",
          data: "0x",
        },
      },
      approvedPayload: DEFAULT_UNSIGNED_TRANSACTION,
    });
    expect(approved.record.conflictKey).toEqual({
      kind: "test.conflict",
      value: "tx-1",
    });
  });

  it("ignores stale prepare results after a newer draft edit starts another prepare", async () => {
    const stalePrepare = createDeferred<{ status: "ready"; prepared: typeof DEFAULT_UNSIGNED_TRANSACTION }>();
    const latestPrepare = createDeferred<{ status: "ready"; prepared: typeof DEFAULT_UNSIGNED_TRANSACTION }>();

    const prepare = vi
      .fn()
      .mockResolvedValueOnce({
        status: "ready" as const,
        prepared: structuredClone(DEFAULT_UNSIGNED_TRANSACTION),
      })
      .mockImplementationOnce(async () => await stalePrepare.promise)
      .mockImplementationOnce(async () => await latestPrepare.promise);

    const namespaces = new NamespaceTransactions([
      [
        "eip155",
        createNamespaceTransactionStub({
          prepare: prepare as never,
          applyDraftEdit: ((context: {
            request: { payload: Record<string, unknown> };
            edit: { changes: Array<{ value: string | null }> };
          }) => ({
            ...context.request,
            payload: {
              ...context.request.payload,
              nonce: context.edit.changes[0]?.value ?? context.request.payload.nonce,
            },
          })) as never,
        }),
      ],
    ]);
    const { transactionStore, sessions } = createServices(namespaces);

    await transactionStore.createTransaction(createTransactionInput());
    await sessions.openSession({ transactionId: "tx-1", approvalId: "approval-1" });

    const firstPrepare = sessions.prepareSession({
      transactionId: "tx-1",
      approvalId: "approval-1",
    });

    const secondPrepare = sessions.applyDraftEdit({
      transactionId: "tx-1",
      approvalId: "approval-1",
      edit: {
        namespace: "eip155",
        changes: [{ field: "nonce", value: "0x8" }],
      },
    });

    stalePrepare.resolve({
      status: "ready",
      prepared: structuredClone(DEFAULT_UNSIGNED_TRANSACTION),
    });
    const staleResult = await firstPrepare;

    expect(staleResult.prepare.status).toBe("preparing");
    expect(staleResult.draft.revision).toBe(1);

    latestPrepare.resolve({
      status: "ready",
      prepared: {
        ...structuredClone(DEFAULT_UNSIGNED_TRANSACTION),
        nonce: "0x8",
      },
    });
    const latestResult = await secondPrepare;

    expect(latestResult.prepare.status).toBe("ready");
    expect(latestResult.prepare.status === "ready" ? latestResult.prepare.approvedPayload : null).toMatchObject({
      nonce: "0x8",
    });
    expect(sessions.getSession("tx-1")).toMatchObject({
      draft: {
        revision: 1,
      },
      prepare: {
        status: "ready",
      },
    });
  });
});
