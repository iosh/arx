import { describe, expect, it, vi } from "vitest";
import { createAccountCodecRegistry, eip155Codec } from "../accounts/addressing/codec.js";
import { eip155AddressCodec } from "../chains/eip155/addressCodec.js";
import { ChainAddressCodecRegistry } from "../chains/registry.js";
import type { Eip155RpcClient } from "../rpc/namespaceClients/eip155.js";
import type {
  CreateTransactionInput,
  JsonValue,
  ListRecoverableTransactionAggregatesQuery,
  ListTransactionHistoryQuery,
  TransactionAggregate,
  TransactionConflictKey,
  TransactionRecord,
  TransactionsStoragePort,
} from "./aggregate/index.js";
import { TransactionConflictKeyCollisionError } from "./aggregate/index.js";
import { TransactionAggregateStore } from "./aggregate/TransactionAggregateStore.js";
import { createTransactionServices } from "./createTransactionServices.js";
import { createEip155Transaction } from "./namespace/eip155/transaction.js";
import { NamespaceTransactions } from "./namespace/NamespaceTransactions.js";
import { TransactionAcceptanceCommitError } from "./submission/errors.js";

const accountCodecs = createAccountCodecRegistry([eip155Codec]);

const cloneAggregate = (aggregate: TransactionAggregate): TransactionAggregate => structuredClone(aggregate);

const compareRecordsNewestFirst = (left: TransactionRecord, right: TransactionRecord): number =>
  right.createdAt - left.createdAt || right.id.localeCompare(left.id);

const findConflictingActiveRecords = (
  current: TransactionAggregate["record"],
  records: TransactionRecord[],
): TransactionRecord[] => {
  const conflictKey = current.conflictKey;
  if (!conflictKey) {
    return [];
  }

  return records.filter((candidate) => {
    if (candidate.id === current.id) {
      return false;
    }
    if (candidate.conflictKey?.kind !== conflictKey.kind || candidate.conflictKey.value !== conflictKey.value) {
      return false;
    }
    if (candidate.status !== "submitting" && candidate.status !== "submitted") {
      return false;
    }
    if (
      current.replacesTransactionId &&
      current.replacesTransactionId === candidate.id &&
      candidate.status === "submitted"
    ) {
      return false;
    }
    return true;
  });
};

type CreateTransactionInputOverrides = Omit<Partial<CreateTransactionInput>, "request"> & {
  request?: {
    kind?: CreateTransactionInput["request"]["kind"];
    payload?: JsonValue;
  };
};

type RpcFeeHistory = Awaited<ReturnType<Eip155RpcClient["getFeeHistory"]>>;
type RpcBlock = Awaited<ReturnType<Eip155RpcClient["getBlockByNumber"]>>;
type RpcReceipt = NonNullable<Awaited<ReturnType<Eip155RpcClient["getTransactionReceipt"]>>>;

const DEFAULT_BROADCAST_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

const createRpcFeeHistory = (): RpcFeeHistory =>
  ({
    oldestBlock: "0x1",
    baseFeePerGas: [],
    gasUsedRatio: [],
    reward: [],
  }) as RpcFeeHistory;

const createRpcBlock = (): RpcBlock =>
  ({
    baseFeePerGas: null,
  }) as RpcBlock;

const createRpcReceipt = (overrides: Partial<RpcReceipt>): RpcReceipt => overrides as RpcReceipt;

const createTransactionInput = (overrides: CreateTransactionInputOverrides = {}): CreateTransactionInput => ({
  namespace: overrides.namespace ?? "eip155",
  chainRef: overrides.chainRef ?? "eip155:1",
  origin: overrides.origin ?? "https://dapp.example",
  source: overrides.source ?? "dapp",
  requestId: overrides.requestId ?? "request-1",
  accountKey: overrides.accountKey ?? "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  request: {
    kind: overrides.request?.kind ?? "eip155.rpc.eth_sendTransaction",
    payload: structuredClone(
      overrides.request?.payload ?? {
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
      const conflicting = findConflictingActiveRecords(
        aggregate.record,
        [...store.values()].map((candidate) => structuredClone(candidate.record)),
      );
      if (conflicting.length > 0) {
        const conflictKey = aggregate.record.conflictKey;
        if (!conflictKey) {
          throw new Error(`Expected aggregate "${aggregate.record.id}" to have a conflict key.`);
        }
        throw new TransactionConflictKeyCollisionError({
          transactionId: aggregate.record.id,
          conflictKey,
          conflictingTransactionIds: conflicting.map((candidate) => candidate.id),
        });
      }
      await port.saveTransactionAggregate(aggregate);
    },
    async listTransactionHistory(query: ListTransactionHistoryQuery = {}) {
      const records = [...store.values()].map((aggregate) => structuredClone(aggregate.record));
      const filtered = records.filter((record) => {
        if (query.namespace !== undefined && record.namespace !== query.namespace) return false;
        if (query.chainRef !== undefined && record.chainRef !== query.chainRef) return false;
        if (query.accountKey !== undefined && record.accountKey !== query.accountKey) return false;
        if (query.status !== undefined && record.status !== query.status) return false;
        return true;
      });
      filtered.sort(compareRecordsNewestFirst);
      return filtered.slice(0, query.limit ?? filtered.length);
    },
    async findTransactionRecordsByConflictKey(key: TransactionConflictKey) {
      return [...store.values()]
        .map((aggregate) => structuredClone(aggregate.record))
        .filter((record) => record.conflictKey?.kind === key.kind && record.conflictKey.value === key.value)
        .sort(compareRecordsNewestFirst);
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

const createRpcClientStub = (params?: {
  getTransactionReceipt?: Eip155RpcClient["getTransactionReceipt"];
}): Eip155RpcClient => ({
  request: vi.fn(),
  estimateGas: vi.fn(async () => "0x5208" as const),
  getBalance: vi.fn(async () => "0xde0b6b3a7640000" as const),
  getTransactionCount: vi.fn(async () => "0x7" as const),
  getGasPrice: vi.fn(async () => "0x3b9aca00" as const),
  getMaxPriorityFeePerGas: vi.fn(async () => "0x3b9aca00" as const),
  getFeeHistory: vi.fn(async () => createRpcFeeHistory()),
  getBlockByNumber: vi.fn(async () => createRpcBlock()),
  getTransactionReceipt: params?.getTransactionReceipt ?? vi.fn(async () => null),
  sendRawTransaction: vi.fn(async () => DEFAULT_BROADCAST_HASH),
});

const createServices = (params?: { getTransactionReceipt?: Eip155RpcClient["getTransactionReceipt"] }) => {
  let now = 1_000;
  let nextId = 0;
  const storage = createInMemoryTransactionsStoragePort();
  const rpc = createRpcClientStub(params);
  const namespaces = new NamespaceTransactions([
    [
      "eip155",
      createEip155Transaction({
        chains: new ChainAddressCodecRegistry([eip155AddressCodec]),
        rpcClientFactory: () => rpc,
        signer: {
          signTransaction: vi.fn(async () => ({ raw: "0xdeadbeef" })),
        },
        broadcaster: {
          broadcast: vi.fn(async () => ({
            hash: DEFAULT_BROADCAST_HASH,
          })),
        },
      }),
    ],
  ]);

  const aggregateStore = new TransactionAggregateStore({
    storage: storage.port,
    now: () => now,
    createId: () => {
      nextId += 1;
      return `tx-${nextId}`;
    },
  });

  const services = createTransactionServices({
    aggregateStore,
    namespaces,
    accountCodecs,
    approvalSessionOptions: {
      now: () => now,
      createId: () => {
        nextId += 1;
        return `prepare-${nextId}`;
      },
    },
  });

  return {
    services,
    aggregateStore,
    tick(value: number) {
      now = value;
    },
  };
};

describe("createTransactionServices", () => {
  it("submits an approved transaction through createBroadcastInput and broadcast", async () => {
    const { services, aggregateStore, tick } = createServices();
    const changes: string[][] = [];
    services.transactions.onTransactionsChanged((ids) => changes.push(ids));
    await aggregateStore.createTransaction(createTransactionInput());
    const opened = await services.approvals.openSession({
      transactionId: "tx-1",
      approvalId: "approval-1",
    });
    expect(opened.prepare.status).toBe("ready");

    tick(2_000);
    const approved = await services.approvals.approveTransaction({
      transactionId: "tx-1",
      approvalId: "approval-1",
      expectedPrepareId: opened.prepare.prepareId,
    });
    expect(approved.status).toBe("approved");

    const result = await services.submission.submitApprovedTransaction("tx-1");

    expect(result.broadcastInput).toEqual({
      kind: "eip155.raw_transaction",
      payload: { raw: "0xdeadbeef" },
    });
    expect(result.aggregate.record.status).toBe("submitted");
    expect(result.aggregate.record.submitted).toMatchObject({
      hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nonce: "0x7",
    });
    expect(result.aggregate.submissions[0]?.status).toBe("accepted");
    expect(changes).toEqual([["tx-1"], ["tx-1"], ["tx-1"], ["tx-1"]]);
  });

  it("inspects a submitted transaction and advances it to confirmed", async () => {
    const { services, aggregateStore, tick } = createServices({
      getTransactionReceipt: vi.fn(async () =>
        createRpcReceipt({
          transactionHash: DEFAULT_BROADCAST_HASH,
          status: "0x1",
          blockNumber: "0x123",
        }),
      ) as Eip155RpcClient["getTransactionReceipt"],
    });
    const changes: string[][] = [];
    services.transactions.onTransactionsChanged((ids) => changes.push(ids));

    await aggregateStore.createTransaction(createTransactionInput());
    const opened = await services.approvals.openSession({
      transactionId: "tx-1",
      approvalId: "approval-1",
    });
    tick(2_000);
    const approved = await services.approvals.approveTransaction({
      transactionId: "tx-1",
      approvalId: "approval-1",
      expectedPrepareId: opened.prepare.prepareId,
    });
    expect(approved.status).toBe("approved");
    await services.submission.submitApprovedTransaction("tx-1");

    const result = await services.tracking.inspectSubmittedTransaction("tx-1");

    expect(result.status).toBe("advanced");
    expect(result.aggregate.record.status).toBe("confirmed");
    expect(result.aggregate.record.receipt).toEqual({
      transactionHash: DEFAULT_BROADCAST_HASH,
      status: "0x1",
      blockNumber: "0x123",
    });
    expect(changes.at(-1)).toEqual(["tx-1"]);
  });

  it("resumes recovery by cancelling abandoned approval work and failing incomplete submissions", async () => {
    const { services, aggregateStore, tick } = createServices();
    const changes: string[][] = [];
    services.transactions.onTransactionsChanged((ids) => changes.push(ids));

    await aggregateStore.createTransaction(createTransactionInput({ requestId: "request-1" }));
    await aggregateStore.createTransaction(createTransactionInput({ requestId: "request-2" }));
    const opened = await services.approvals.openSession({
      transactionId: "tx-2",
      approvalId: "approval-2",
    });
    tick(2_000);
    const approved = await services.approvals.approveTransaction({
      transactionId: "tx-2",
      approvalId: "approval-2",
      expectedPrepareId: opened.prepare.prepareId,
    });
    expect(approved.status).toBe("approved");

    const results = await services.recovery.recoverAfterRestart();

    expect(results.map((entry) => [entry.action.transactionId, entry.status, entry.aggregate?.record.status])).toEqual([
      ["tx-2", "applied", "failed"],
      ["tx-1", "applied", "cancelled"],
    ]);
    expect(changes.slice(-2)).toEqual([["tx-2"], ["tx-1"]]);
  });

  it("keeps submitted transactions durable-submitted when one tracking attempt fails", async () => {
    const getTransactionReceipt = vi.fn(async () => {
      throw new Error("temporary rpc outage");
    });
    const { services, aggregateStore, tick } = createServices({
      getTransactionReceipt,
    });

    await aggregateStore.createTransaction(createTransactionInput());
    const opened = await services.approvals.openSession({
      transactionId: "tx-1",
      approvalId: "approval-1",
    });
    tick(2_000);
    const approved = await services.approvals.approveTransaction({
      transactionId: "tx-1",
      approvalId: "approval-1",
      expectedPrepareId: opened.prepare.prepareId,
    });
    expect(approved.status).toBe("approved");
    await services.submission.submitApprovedTransaction("tx-1");

    const result = await services.tracking.inspectSubmittedTransaction("tx-1");
    const aggregate = await aggregateStore.loadTransactionAggregate("tx-1");

    expect(result.status).toBe("retry_later");
    expect(result.aggregate.record.status).toBe("submitted");
    expect(aggregate?.record.status).toBe("submitted");
  });

  it("throws a dedicated acceptance persistence error after broadcast succeeds without failing the submission", async () => {
    let now = 1_000;
    let nextId = 0;
    const storage = createInMemoryTransactionsStoragePort();
    const rpc = createRpcClientStub();
    const namespaces = new NamespaceTransactions([
      [
        "eip155",
        createEip155Transaction({
          chains: new ChainAddressCodecRegistry([eip155AddressCodec]),
          rpcClientFactory: () => rpc,
          signer: {
            signTransaction: vi.fn(async () => ({ raw: "0xdeadbeef" })),
          },
          broadcaster: {
            broadcast: vi.fn(async () => ({
              hash: DEFAULT_BROADCAST_HASH,
            })),
          },
        }),
      ],
    ]);

    const aggregateStore = new TransactionAggregateStore({
      storage: {
        ...storage.port,
        async saveTransactionAggregate(aggregate) {
          if (aggregate.record.status === "submitted") {
            throw new Error("acceptance persist failed");
          }
          await storage.port.saveTransactionAggregate(aggregate);
        },
      },
      now: () => now,
      createId: () => {
        nextId += 1;
        return `tx-${nextId}`;
      },
    });

    const services = createTransactionServices({
      aggregateStore,
      namespaces,
      accountCodecs,
      approvalSessionOptions: {
        now: () => now,
        createId: () => {
          nextId += 1;
          return `prepare-${nextId}`;
        },
      },
    });
    const changes: string[][] = [];
    services.transactions.onTransactionsChanged((ids) => changes.push(ids));

    await aggregateStore.createTransaction(createTransactionInput());
    const opened = await services.approvals.openSession({
      transactionId: "tx-1",
      approvalId: "approval-1",
    });
    now = 2_000;
    const approved = await services.approvals.approveTransaction({
      transactionId: "tx-1",
      approvalId: "approval-1",
      expectedPrepareId: opened.prepare.prepareId,
    });
    expect(approved.status).toBe("approved");

    await expect(services.submission.submitApprovedTransaction("tx-1")).rejects.toBeInstanceOf(
      TransactionAcceptanceCommitError,
    );

    const aggregate = await aggregateStore.loadTransactionAggregate("tx-1");
    expect(aggregate?.record.status).toBe("submitting");
    expect(aggregate?.submissions[0]?.status).toBe("broadcasting");
    expect(changes).toEqual([["tx-1"], ["tx-1"], ["tx-1"]]);
  });

  it("marks a dropped transaction as replaced when another local winner shares the conflict key", async () => {
    const getTransactionReceipt = vi.fn(async () => null);
    const getTransactionCount = vi
      .fn()
      .mockResolvedValueOnce("0x7" as const)
      .mockResolvedValueOnce("0x7" as const)
      .mockResolvedValue("0x8" as const);
    let now = 1_000;
    let nextId = 0;
    const storage = createInMemoryTransactionsStoragePort();
    const rpc: Eip155RpcClient = {
      request: vi.fn(),
      estimateGas: vi.fn(async () => "0x5208" as const),
      getBalance: vi.fn(async () => "0xde0b6b3a7640000" as const),
      getTransactionCount,
      getGasPrice: vi.fn(async () => "0x3b9aca00" as const),
      getMaxPriorityFeePerGas: vi.fn(async () => "0x3b9aca00" as const),
      getFeeHistory: vi.fn(async () => createRpcFeeHistory()),
      getBlockByNumber: vi.fn(async () => createRpcBlock()),
      getTransactionReceipt,
      sendRawTransaction: vi.fn(async () => DEFAULT_BROADCAST_HASH),
    };
    const namespaces = new NamespaceTransactions([
      [
        "eip155",
        createEip155Transaction({
          chains: new ChainAddressCodecRegistry([eip155AddressCodec]),
          rpcClientFactory: () => rpc,
          signer: {
            signTransaction: vi.fn(async () => ({ raw: "0xdeadbeef" })),
          },
          broadcaster: {
            broadcast: vi
              .fn()
              .mockResolvedValueOnce({
                hash: DEFAULT_BROADCAST_HASH,
              })
              .mockResolvedValueOnce({
                hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const,
              }),
          },
        }),
      ],
    ]);
    const aggregateStore = new TransactionAggregateStore({
      storage: storage.port,
      now: () => now,
      createId: () => {
        nextId += 1;
        return `tx-${nextId}`;
      },
    });
    const services = createTransactionServices({
      aggregateStore,
      namespaces,
      accountCodecs,
      approvalSessionOptions: {
        now: () => now,
        createId: () => {
          nextId += 1;
          return `prepare-${nextId}`;
        },
      },
    });
    const changes: string[][] = [];
    services.transactions.onTransactionsChanged((ids) => changes.push(ids));

    await aggregateStore.createTransaction(
      createTransactionInput({
        request: {
          payload: {
            from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x1",
            data: "0x",
            nonce: "0x7",
          },
        },
      }),
    );
    const openedFirst = await services.approvals.openSession({
      transactionId: "tx-1",
      approvalId: "approval-1",
    });
    now = 2_000;
    const approvedFirst = await services.approvals.approveTransaction({
      transactionId: "tx-1",
      approvalId: "approval-1",
      expectedPrepareId: openedFirst.prepare.prepareId,
    });
    expect(approvedFirst.status).toBe("approved");
    const firstSubmission = await services.submission.submitApprovedTransaction("tx-1");
    expect(firstSubmission.aggregate.record.submitted).toMatchObject({
      nonce: "0x7",
    });
    expect(firstSubmission.aggregate.record.conflictKey).toEqual({
      kind: "eip155.nonce",
      value: "eip155:1:eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0x7",
    });

    await aggregateStore.createTransaction(
      createTransactionInput({
        requestId: "request-2",
        request: {
          payload: {
            from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x1",
            data: "0x",
            nonce: "0x7",
          },
        },
        replacement: {
          transactionId: "tx-1",
          type: "speed_up",
        },
      }),
    );
    const openedSecond = await services.approvals.openSession({
      transactionId: "tx-4",
      approvalId: "approval-2",
    });
    now = 3_000;
    const approvedSecond = await services.approvals.approveTransaction({
      transactionId: "tx-4",
      approvalId: "approval-2",
      expectedPrepareId: openedSecond.prepare.prepareId,
    });
    expect(approvedSecond.status).toBe("approved");
    await services.submission.submitApprovedTransaction("tx-4");
    await aggregateStore.recordTransactionConfirmed({
      transactionId: "tx-4",
      receipt: {
        transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        status: "0x1",
        blockNumber: "0x123",
      },
    });

    const result = await services.tracking.inspectSubmittedTransaction("tx-1");

    expect(result.status).toBe("advanced");
    expect(result.aggregate.record.status).toBe("replaced");
    expect(result.aggregate.record.replacedByTransactionId).toBe("tx-4");
    expect(changes.at(-1)).toEqual(["tx-1"]);
  });

  it("replaces other submitted local transactions as soon as the winner is confirmed", async () => {
    const { services, aggregateStore, tick } = createServices({
      getTransactionReceipt: vi
        .fn()
        .mockResolvedValueOnce({
          transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          status: "0x1",
          blockNumber: "0x123",
        })
        .mockResolvedValue(null),
    });

    await aggregateStore.createTransaction(
      createTransactionInput({
        request: {
          payload: {
            from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x1",
            data: "0x",
            nonce: "0x7",
          },
        },
      }),
    );
    const openedFirst = await services.approvals.openSession({
      transactionId: "tx-1",
      approvalId: "approval-1",
    });
    tick(2_000);
    const approvedFirst = await services.approvals.approveTransaction({
      transactionId: "tx-1",
      approvalId: "approval-1",
      expectedPrepareId: openedFirst.prepare.prepareId,
    });
    expect(approvedFirst.status).toBe("approved");
    await services.submission.submitApprovedTransaction("tx-1");

    await aggregateStore.createTransaction(
      createTransactionInput({
        requestId: "request-2",
        request: {
          payload: {
            from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x1",
            data: "0x",
            nonce: "0x7",
          },
        },
        replacement: {
          transactionId: "tx-1",
          type: "speed_up",
        },
      }),
    );
    const openedSecond = await services.approvals.openSession({
      transactionId: "tx-4",
      approvalId: "approval-2",
    });
    tick(3_000);
    const approvedSecond = await services.approvals.approveTransaction({
      transactionId: "tx-4",
      approvalId: "approval-2",
      expectedPrepareId: openedSecond.prepare.prepareId,
    });
    expect(approvedSecond.status).toBe("approved");
    await services.submission.submitApprovedTransaction("tx-4");

    const result = await services.tracking.inspectSubmittedTransaction("tx-4");

    expect(result.status).toBe("advanced");
    expect(result.aggregate.record.status).toBe("confirmed");

    const loser = await aggregateStore.loadTransactionAggregate("tx-1");
    expect(loser?.record.status).toBe("replaced");
    expect(loser?.record.replacedByTransactionId).toBe("tx-4");
  });

  it("continues restart recovery after one submitted tracking attempt should retry later", async () => {
    const getTransactionReceipt = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary rpc outage"))
      .mockResolvedValue(null);
    const { services, aggregateStore, tick } = createServices({
      getTransactionReceipt,
    });

    await aggregateStore.createTransaction(createTransactionInput({ requestId: "request-1" }));
    const opened = await services.approvals.openSession({
      transactionId: "tx-1",
      approvalId: "approval-1",
    });
    tick(2_000);
    const approved = await services.approvals.approveTransaction({
      transactionId: "tx-1",
      approvalId: "approval-1",
      expectedPrepareId: opened.prepare.prepareId,
    });
    expect(approved.status).toBe("approved");
    await services.submission.submitApprovedTransaction("tx-1");

    await aggregateStore.createTransaction(createTransactionInput({ requestId: "request-2" }));

    const results = await services.recovery.recoverAfterRestart();

    expect(results.map((entry) => [entry.action.transactionId, entry.status, entry.aggregate?.record.status])).toEqual([
      ["tx-4", "applied", "cancelled"],
      ["tx-1", "deferred", "submitted"],
    ]);
  });
});
