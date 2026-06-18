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
  source: overrides.source ?? "provider",
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
    async insertApprovedTransactionAggregate({ aggregate }) {
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
      await port.insertTransactionAggregate(aggregate);
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

type CreatedServices = ReturnType<typeof createServices>;

const approveTransactionReview = async (params: {
  services: CreatedServices["services"];
  approvalId: string;
  input?: CreateTransactionInput;
}) => {
  const requested = await params.services.transactions.requestTransactionApproval({
    ...(params.input ?? createTransactionInput()),
    approvalId: params.approvalId,
  });
  const approved = await params.services.transactions.approveTransaction({
    approvalId: params.approvalId,
    expectedPrepareId: requested.approval.prepare.id,
  });
  if (approved.status !== "approved") {
    throw new Error(`Expected approval "${params.approvalId}" to create a transaction.`);
  }

  return {
    approval: requested.approval,
    transaction: approved.transaction,
  };
};

describe("createTransactionServices", () => {
  it("submits an approved transaction through createBroadcastInput and broadcast", async () => {
    const { services, tick } = createServices();
    const changes: string[][] = [];
    services.transactions.onTransactionsChanged((ids) => changes.push(ids));
    const approved = await approveTransactionReview({
      services,
      approvalId: "approval-1",
    });

    tick(2_000);
    const result = await services.submission.submitApprovedTransaction(approved.transaction.id);

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
    expect(changes).toEqual([
      [approved.transaction.id],
      [approved.transaction.id],
      [approved.transaction.id],
      [approved.transaction.id],
    ]);
  });

  it("inspects a submitted transaction and advances it to confirmed", async () => {
    const { services, tick } = createServices({
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

    const approved = await approveTransactionReview({
      services,
      approvalId: "approval-1",
    });
    tick(2_000);
    await services.submission.submitApprovedTransaction(approved.transaction.id);

    const result = await services.tracking.inspectSubmittedTransaction(approved.transaction.id);

    expect(result.status).toBe("advanced");
    expect(result.aggregate.record.status).toBe("confirmed");
    expect(result.aggregate.record.receipt).toEqual({
      transactionHash: DEFAULT_BROADCAST_HASH,
      status: "0x1",
      blockNumber: "0x123",
    });
    expect(changes.at(-1)).toEqual([approved.transaction.id]);
  });

  it("resumes recovery by failing incomplete approved submissions", async () => {
    const { services, tick } = createServices();
    const changes: string[][] = [];
    services.transactions.onTransactionsChanged((ids) => changes.push(ids));

    await services.transactions.requestTransactionApproval({
      ...createTransactionInput({ requestId: "request-1" }),
      approvalId: "approval-1",
    });
    const approved = await approveTransactionReview({
      services,
      approvalId: "approval-2",
      input: createTransactionInput({ requestId: "request-2" }),
    });
    tick(2_000);

    const results = await services.recovery.recoverAfterRestart();

    expect(results.map((entry) => [entry.action.transactionId, entry.status, entry.aggregate?.record.status])).toEqual([
      [approved.transaction.id, "applied", "failed"],
    ]);
    expect(changes.at(-1)).toEqual([approved.transaction.id]);
  });

  it("keeps submitted transactions durable-submitted when one tracking attempt fails", async () => {
    const getTransactionReceipt = vi.fn(async () => {
      throw new Error("temporary rpc outage");
    });
    const { services, aggregateStore, tick } = createServices({
      getTransactionReceipt,
    });

    const approved = await approveTransactionReview({
      services,
      approvalId: "approval-1",
    });
    tick(2_000);
    await services.submission.submitApprovedTransaction(approved.transaction.id);

    const result = await services.tracking.inspectSubmittedTransaction(approved.transaction.id);
    const aggregate = await aggregateStore.loadTransactionAggregate(approved.transaction.id);

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

    const approved = await approveTransactionReview({
      services,
      approvalId: "approval-1",
    });
    now = 2_000;

    await expect(services.submission.submitApprovedTransaction(approved.transaction.id)).rejects.toBeInstanceOf(
      TransactionAcceptanceCommitError,
    );

    const aggregate = await aggregateStore.loadTransactionAggregate(approved.transaction.id);
    expect(aggregate?.record.status).toBe("submitting");
    expect(aggregate?.submissions[0]?.status).toBe("broadcasting");
    expect(changes).toEqual([[approved.transaction.id], [approved.transaction.id], [approved.transaction.id]]);
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

    const firstApproved = await approveTransactionReview({
      services,
      approvalId: "approval-1",
      input: createTransactionInput({
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
    });
    now = 2_000;
    const firstSubmission = await services.submission.submitApprovedTransaction(firstApproved.transaction.id);
    expect(firstSubmission.aggregate.record.submitted).toMatchObject({
      nonce: "0x7",
    });
    expect(firstSubmission.aggregate.record.conflictKey).toEqual({
      kind: "eip155.nonce",
      value: "eip155:1:eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0x7",
    });

    const secondReview = await services.transactions.createSpeedUpReplacement({
      ...createTransactionInput({
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
      }),
      approvalId: "approval-2",
      transactionId: firstApproved.transaction.id,
    });
    now = 3_000;
    const approvedSecond = await services.transactions.approveTransaction({
      approvalId: "approval-2",
      expectedPrepareId: secondReview.approval.prepare.id,
    });
    if (approvedSecond.status !== "approved") {
      throw new Error("Expected replacement approval to create a transaction.");
    }
    await services.submission.submitApprovedTransaction(approvedSecond.transaction.id);
    await aggregateStore.recordTransactionConfirmed({
      transactionId: approvedSecond.transaction.id,
      receipt: {
        transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        status: "0x1",
        blockNumber: "0x123",
      },
    });

    const result = await services.tracking.inspectSubmittedTransaction(firstApproved.transaction.id);

    expect(result.status).toBe("advanced");
    expect(result.aggregate.record.status).toBe("replaced");
    expect(result.aggregate.record.replacedByTransactionId).toBe(approvedSecond.transaction.id);
    expect(changes.at(-1)).toEqual([firstApproved.transaction.id]);
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

    const firstApproved = await approveTransactionReview({
      services,
      approvalId: "approval-1",
      input: createTransactionInput({
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
    });
    tick(2_000);
    await services.submission.submitApprovedTransaction(firstApproved.transaction.id);

    const secondReview = await services.transactions.createSpeedUpReplacement({
      ...createTransactionInput({
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
      }),
      approvalId: "approval-2",
      transactionId: firstApproved.transaction.id,
    });
    tick(3_000);
    const approvedSecond = await services.transactions.approveTransaction({
      approvalId: "approval-2",
      expectedPrepareId: secondReview.approval.prepare.id,
    });
    if (approvedSecond.status !== "approved") {
      throw new Error("Expected replacement approval to create a transaction.");
    }
    await services.submission.submitApprovedTransaction(approvedSecond.transaction.id);

    const result = await services.tracking.inspectSubmittedTransaction(approvedSecond.transaction.id);

    expect(result.status).toBe("advanced");
    expect(result.aggregate.record.status).toBe("confirmed");

    const loser = await aggregateStore.loadTransactionAggregate(firstApproved.transaction.id);
    expect(loser?.record.status).toBe("replaced");
    expect(loser?.record.replacedByTransactionId).toBe(approvedSecond.transaction.id);
  });

  it("continues restart recovery after one submitted tracking attempt should retry later", async () => {
    const getTransactionReceipt = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary rpc outage"))
      .mockResolvedValue(null);
    const { services, tick } = createServices({
      getTransactionReceipt,
    });

    const approved = await approveTransactionReview({
      services,
      approvalId: "approval-1",
      input: createTransactionInput({ requestId: "request-1" }),
    });
    tick(2_000);
    await services.submission.submitApprovedTransaction(approved.transaction.id);

    await services.transactions.requestTransactionApproval({
      ...createTransactionInput({ requestId: "request-2" }),
      approvalId: "approval-2",
    });

    const results = await services.recovery.recoverAfterRestart();

    expect(results.map((entry) => [entry.action.transactionId, entry.status, entry.aggregate?.record.status])).toEqual([
      [approved.transaction.id, "deferred", "submitted"],
    ]);
  });
});
