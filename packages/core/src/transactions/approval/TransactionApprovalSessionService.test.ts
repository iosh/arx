import { describe, expect, it, vi } from "vitest";
import { eip155AddressCodec } from "../../chains/eip155/addressCodec.js";
import { ChainAddressCodecRegistry } from "../../chains/registry.js";
import type { Eip155RpcClient } from "../../rpc/namespaceClients/eip155.js";
import { createDeferred } from "../../utils/deferred.js";
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
  CreateApprovedTransactionInput,
  CreateTransactionInput,
  JsonValue,
  ListRecoverableTransactionAggregatesQuery,
  ListTransactionHistoryQuery,
  TransactionAggregate,
  TransactionConflictKey,
  TransactionRecord,
  TransactionsStoragePort,
} from "../aggregate/index.js";
import { TransactionConflictKeyCollisionError } from "../aggregate/index.js";
import { TransactionAggregateStore } from "../aggregate/TransactionAggregateStore.js";
import { createEip155Transaction } from "../namespace/eip155/transaction.js";
import { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import { TransactionResourceLock } from "../TransactionResourceLock.js";
import { TransactionApprovalSessionNotFoundError } from "./errors.js";
import { TransactionApprovalSessionService } from "./TransactionApprovalSessionService.js";

const DEFAULT_RPC_TRANSACTION_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

type RpcFeeHistory = Awaited<ReturnType<Eip155RpcClient["getFeeHistory"]>>;
type RpcBlock = Awaited<ReturnType<Eip155RpcClient["getBlockByNumber"]>>;

type CreateTransactionInputOverrides = Omit<Partial<CreateTransactionInput>, "request"> & {
  request?: {
    kind?: CreateTransactionInput["request"]["kind"];
    payload?: JsonValue;
  };
};

type CreateApprovedTransactionInputOverrides = Omit<Partial<CreateApprovedTransactionInput>, "request"> & {
  request?: {
    kind?: CreateApprovedTransactionInput["request"]["kind"];
    payload?: JsonValue;
  };
};

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
    if (candidate.id === current.id) return false;
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

const createTransactionInput = (overrides: CreateTransactionInputOverrides = {}): CreateTransactionInput => ({
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
  ...(overrides.replacement !== undefined ? { replacement: overrides.replacement } : {}),
});

const createApprovedTransactionInput = (
  overrides: CreateApprovedTransactionInputOverrides = {},
): CreateApprovedTransactionInput => ({
  ...createTransactionInput(overrides),
  approvalId: overrides.approvalId ?? "approval-1",
  approvedAt: overrides.approvedAt ?? null,
  approvedRequestPayload: overrides.approvedRequestPayload ?? structuredClone(DEFAULT_UNSIGNED_TRANSACTION),
  submissionId: overrides.submissionId ?? "submission-1",
  conflictKey: overrides.conflictKey ?? null,
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

const createEip155RpcClientStub = (): Eip155RpcClient => ({
  request: vi.fn(),
  estimateGas: vi.fn(async () => "0x5208" as const),
  getBalance: vi.fn(async () => "0xde0b6b3a7640000" as const),
  getTransactionCount: vi.fn(async () => "0x7" as const),
  getGasPrice: vi.fn(async () => "0x3b9aca00" as const),
  getMaxPriorityFeePerGas: vi.fn(async () => "0x3b9aca00" as const),
  getFeeHistory: vi.fn(async () => createRpcFeeHistory()),
  getBlockByNumber: vi.fn(async () => createRpcBlock()),
  getTransactionReceipt: vi.fn(async () => null),
  sendRawTransaction: vi.fn(async () => DEFAULT_RPC_TRANSACTION_HASH),
});

const createServices = (namespaces: NamespaceTransactions) => {
  let now = 1_000;
  let nextTransactionId = 0;
  let nextPrepareId = 0;
  const storage = createInMemoryTransactionsStoragePort();
  const aggregateStore = new TransactionAggregateStore({
    storage: storage.port,
    now: () => now,
    createId: () => {
      nextTransactionId += 1;
      return `tx-${nextTransactionId}`;
    },
  });
  const sessions = new TransactionApprovalSessionService({
    transactions: aggregateStore,
    namespaces,
    resourceLock: new TransactionResourceLock(),
    now: () => now,
    createId: () => {
      nextPrepareId += 1;
      return `prepare-${nextPrepareId}`;
    },
  });

  return {
    aggregateStore,
    sessions,
    tick: (value: number) => {
      now = value;
    },
  };
};

const openSessionFromRequest = async (params: {
  sessions: TransactionApprovalSessionService;
  approvalId: string;
  input?: CreateTransactionInput;
}) => {
  const input = params.input ?? createTransactionInput();

  return await params.sessions.openSession({
    approvalId: params.approvalId,
    namespace: input.namespace,
    chainRef: input.chainRef,
    source: input.source,
    origin: input.origin,
    accountKey: input.accountKey,
    from: accountCodecs.toCanonicalAddressFromAccountKey({
      accountKey: input.accountKey,
    }),
    requestId: input.requestId ?? null,
    request: structuredClone(input.request),
    replacement: input.replacement ?? null,
  });
};

const createEip155Namespaces = (rpc: Eip155RpcClient): NamespaceTransactions =>
  new NamespaceTransactions([
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

describe("TransactionApprovalSessionService", () => {
  it("opens an EIP-155 session, reapplies draft edits, and approves the exact prepared payload", async () => {
    const rpc = createEip155RpcClientStub();
    const { sessions, tick } = createServices(createEip155Namespaces(rpc));

    const opened = await openSessionFromRequest({
      sessions,
      approvalId: "approval-1",
    });

    expect(opened.prepare.status).toBe("ready");
    expect(opened.prepare.status === "ready" ? opened.prepare.approvedPayload : null).toMatchObject({
      nonce: "0x7",
      gas: "0x5208",
      gasPrice: "0x3b9aca00",
    });
    expect(opened.review).toMatchObject({
      namespace: "eip155",
      kind: "native_transfer",
      nonce: "0x7",
      gasLimit: "0x5208",
    });

    tick(2_000);
    const edited = await sessions.applyDraftEdit({
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
    expect(edited.review).toMatchObject({
      nonce: "0x8",
    });

    tick(3_000);
    const approved = await sessions.approveTransaction({
      approvalId: "approval-1",
      expectedPrepareId: edited.prepare.prepareId,
    });

    expect(approved.status).toBe("approved");
    expect(approved.status === "approved" ? approved.aggregate.record.status : null).toBe("submitting");
    expect(approved.status === "approved" ? approved.aggregate.record.approvedRequest : null).toMatchObject({
      approvalId: "approval-1",
      approvedAt: 3_000,
      payload: {
        nonce: "0x8",
        gas: "0x5208",
      },
    });
    expect(approved.status === "approved" ? approved.aggregate.record.conflictKey : null).toEqual({
      kind: "eip155.nonce",
      value:
        approved.status === "approved"
          ? `${approved.aggregate.record.chainRef}:${approved.aggregate.record.accountKey}:0x8`
          : "",
    });
    expect(sessions.getSessionByApprovalId("approval-1")).toBeNull();
  });

  it("delegates approved conflict key derivation to the namespace proposal", async () => {
    const deriveConflictKey = vi.fn((context: { transactionId: string }) => ({
      kind: "test.conflict",
      value: context.transactionId,
    }));
    const namespaces = new NamespaceTransactions([
      [
        "eip155",
        createNamespaceTransactionStub({
          deriveConflictKey: deriveConflictKey as never,
        }),
      ],
    ]);
    const { sessions } = createServices(namespaces);

    const opened = await openSessionFromRequest({
      sessions,
      approvalId: "approval-1",
    });

    const approved = await sessions.approveTransaction({
      approvalId: "approval-1",
      expectedPrepareId: opened.prepare.prepareId,
    });

    expect(deriveConflictKey).toHaveBeenCalledWith({
      transactionId: "approval-1",
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
    expect(approved.status === "approved" ? approved.aggregate.record.conflictKey : null).toEqual({
      kind: "test.conflict",
      value: "approval-1",
    });
  });

  it("finalizes wallet-managed nonce at approve time and writes the refreshed payload", async () => {
    const rpc = createEip155RpcClientStub();
    rpc.getTransactionCount = vi.fn().mockResolvedValueOnce("0x7").mockResolvedValueOnce("0x9");
    const { sessions, tick } = createServices(createEip155Namespaces(rpc));

    const opened = await openSessionFromRequest({
      sessions,
      approvalId: "approval-1",
    });
    expect(opened.prepare.status === "ready" ? opened.prepare.approvedPayload : null).toMatchObject({
      nonce: "0x7",
    });

    tick(2_000);
    const approved = await sessions.approveTransaction({
      approvalId: "approval-1",
      expectedPrepareId: opened.prepare.prepareId,
    });

    expect(approved.status === "approved" ? approved.aggregate.record.approvedRequest?.payload : null).toMatchObject({
      nonce: "0x9",
    });
    expect(approved.status === "approved" ? approved.aggregate.record.conflictKey : null).toEqual({
      kind: "eip155.nonce",
      value:
        approved.status === "approved"
          ? `${approved.aggregate.record.chainRef}:${approved.aggregate.record.accountKey}:0x9`
          : "",
    });
  });

  it("returns approval_stale for fixed nonce conflicts and refreshes the session review", async () => {
    const rpc = createEip155RpcClientStub();
    rpc.getTransactionCount = vi.fn().mockResolvedValue("0x8");
    const { sessions } = createServices(createEip155Namespaces(rpc));

    const opened = await openSessionFromRequest({
      sessions,
      approvalId: "approval-1",
      input: createTransactionInput({
        request: {
          payload: {
            from: DEFAULT_FROM,
            to: DEFAULT_TO,
            value: "0x1",
            data: "0x",
            nonce: "0x6",
          },
        },
      }),
    });

    const stale = await sessions.approveTransaction({
      approvalId: "approval-1",
      expectedPrepareId: opened.prepare.prepareId,
    });

    expect(stale.status).toBe("approval_stale");
    expect(stale.status === "approval_stale" ? stale.stale.reason : null).toBe("transaction.approval_stale");

    const refreshed = sessions.getSessionByApprovalId("approval-1");
    expect(refreshed?.prepare.status).toBe("ready");
    expect(refreshed?.prepare.status === "ready" ? refreshed.prepare.approvedPayload : null).toMatchObject({
      nonce: "0x6",
    });
    expect(refreshed?.review).toMatchObject({
      nonce: "0x6",
    });
  });

  it("returns approval_stale for fixed nonce conflicts that only exist locally", async () => {
    const rpc = createEip155RpcClientStub();
    rpc.getTransactionCount = vi.fn().mockResolvedValue("0x7");
    const { aggregateStore, sessions } = createServices(createEip155Namespaces(rpc));

    await aggregateStore.createApprovedTransaction(
      createApprovedTransactionInput({
        requestId: "request-1",
        approvedRequestPayload: structuredClone(DEFAULT_UNSIGNED_TRANSACTION),
        conflictKey: {
          kind: "eip155.nonce",
          value: `${DEFAULT_CHAIN_REF}:${createDefaultAccountKey()}:0x7`,
        },
      }),
    );
    const opened = await openSessionFromRequest({
      sessions,
      approvalId: "approval-2",
      input: createTransactionInput({
        requestId: "request-2",
        request: {
          payload: {
            from: DEFAULT_FROM,
            to: DEFAULT_TO,
            value: "0x1",
            data: "0x",
            nonce: "0x7",
          },
        },
      }),
    });

    const stale = await sessions.approveTransaction({
      approvalId: "approval-2",
      expectedPrepareId: opened.prepare.prepareId,
    });

    expect(stale.status).toBe("approval_stale");
    expect(stale.status === "approval_stale" ? stale.session?.prepare.prepareId : null).not.toBe(
      opened.prepare.prepareId,
    );
    expect(stale.status === "approval_stale" ? stale.session?.prepare.status : null).toBe("ready");
    expect(stale.status === "approval_stale" ? stale.stale.data : null).toMatchObject({
      currentNonce: "0x7",
      conflictingTransactionIds: ["tx-1"],
    });
  });

  it("allows fixed-nonce replacement when replacing a submitted local transaction", async () => {
    const rpc = createEip155RpcClientStub();
    rpc.getTransactionCount = vi.fn().mockResolvedValue("0x8");
    const { aggregateStore, sessions } = createServices(createEip155Namespaces(rpc));
    const conflictKey = {
      kind: "eip155.nonce",
      value: `${DEFAULT_CHAIN_REF}:${createDefaultAccountKey()}:0x7`,
    } as const;

    await aggregateStore.createApprovedTransaction(
      createApprovedTransactionInput({
        requestId: "request-1",
        conflictKey,
      }),
    );
    await aggregateStore.beginSubmissionSigning({
      transactionId: "tx-1",
      submissionId: "submission-1",
    });
    await aggregateStore.queueSubmissionBroadcast({
      transactionId: "tx-1",
      submissionId: "submission-1",
    });
    await aggregateStore.recordBroadcastAcceptance({
      transactionId: "tx-1",
      submissionId: "submission-1",
      submitted: {
        hash: DEFAULT_RPC_TRANSACTION_HASH,
        chainId: "0xa",
        from: DEFAULT_FROM,
        nonce: "0x7",
      },
    });

    const opened = await openSessionFromRequest({
      sessions,
      approvalId: "approval-2",
      input: createTransactionInput({
        requestId: "request-2",
        replacement: {
          transactionId: "tx-1",
          type: "speed_up",
        },
        request: {
          payload: {
            from: DEFAULT_FROM,
            to: DEFAULT_TO,
            value: "0x1",
            data: "0x",
            nonce: "0x7",
          },
        },
      }),
    });

    const approved = await sessions.approveTransaction({
      approvalId: "approval-2",
      expectedPrepareId: opened.prepare.prepareId,
    });

    expect(approved.status).toBe("approved");
    expect(approved.status === "approved" ? approved.aggregate.record.conflictKey : null).toEqual(conflictKey);
  });

  it("allows approval sessions without a review builder", async () => {
    const namespace = createNamespaceTransactionStub();
    if (!namespace.proposal) {
      throw new Error("Expected namespace proposal.");
    }
    delete namespace.proposal.buildReview;

    const namespaces = new NamespaceTransactions([["eip155", namespace]]);
    const { sessions } = createServices(namespaces);

    const opened = await openSessionFromRequest({
      sessions,
      approvalId: "approval-1",
    });

    expect(opened.prepare.status).toBe("ready");
    expect(opened.review).toBeNull();

    const approved = await sessions.approveTransaction({
      approvalId: "approval-1",
      expectedPrepareId: opened.prepare.prepareId,
    });

    expect(approved.status).toBe("approved");
  });

  it("returns a failed approval result when finalize throws", async () => {
    const namespaces = new NamespaceTransactions([
      [
        "eip155",
        createNamespaceTransactionStub({
          finalizeApproval: vi.fn(async () => {
            throw new Error("rpc down");
          }) as never,
        }),
      ],
    ]);
    const { sessions } = createServices(namespaces);

    const opened = await openSessionFromRequest({
      sessions,
      approvalId: "approval-1",
    });

    const failed = await sessions.approveTransaction({
      approvalId: "approval-1",
      expectedPrepareId: opened.prepare.prepareId,
    });

    expect(failed.status).toBe("failed");
    expect(failed.status === "failed" ? failed.error : null).toMatchObject({
      reason: "transaction.approval.finalize_failed",
      message: "rpc down",
    });
    expect(failed.status === "failed" ? failed.session.prepare.status : null).toBe("failed");
    expect(sessions.getSessionByApprovalId("approval-1")?.prepare.status).toBe("failed");
  });

  it("does not let a concurrent draft edit replace the session while approval is finalizing", async () => {
    const finalize = createDeferred<{
      status: "approved";
      approvedPayload: typeof DEFAULT_UNSIGNED_TRANSACTION;
      conflictKey: null;
      expiresAt: null;
    }>();
    const namespaces = new NamespaceTransactions([
      [
        "eip155",
        createNamespaceTransactionStub({
          finalizeApproval: vi.fn(async () => await finalize.promise) as never,
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
    const { sessions } = createServices(namespaces);

    const opened = await openSessionFromRequest({
      sessions,
      approvalId: "approval-1",
    });

    const approvePromise = sessions.approveTransaction({
      approvalId: "approval-1",
      expectedPrepareId: opened.prepare.prepareId,
    });

    let editSettled = false;
    const editPromise = sessions
      .applyDraftEdit({
        approvalId: "approval-1",
        edit: {
          namespace: "eip155",
          changes: [{ field: "nonce", value: "0x8" }],
        },
      })
      .finally(() => {
        editSettled = true;
      });

    await Promise.resolve();
    await Promise.resolve();
    expect(editSettled).toBe(false);

    finalize.resolve({
      status: "approved",
      approvedPayload: structuredClone(DEFAULT_UNSIGNED_TRANSACTION),
      conflictKey: null,
      expiresAt: null,
    });

    const approved = await approvePromise;
    expect(approved.status).toBe("approved");
    await expect(editPromise).rejects.toThrow(TransactionApprovalSessionNotFoundError);
  });

  it("ignores stale prepare results after a newer draft edit starts another prepare", async () => {
    const stalePrepare = createDeferred<{
      status: "ready";
      prepared: typeof DEFAULT_UNSIGNED_TRANSACTION;
      reviewSnapshot: typeof DEFAULT_UNSIGNED_TRANSACTION;
    }>();
    const latestPrepare = createDeferred<{
      status: "ready";
      prepared: typeof DEFAULT_UNSIGNED_TRANSACTION;
      reviewSnapshot: typeof DEFAULT_UNSIGNED_TRANSACTION;
    }>();

    const prepare = vi
      .fn()
      .mockResolvedValueOnce({
        status: "ready" as const,
        prepared: structuredClone(DEFAULT_UNSIGNED_TRANSACTION),
        reviewSnapshot: structuredClone(DEFAULT_UNSIGNED_TRANSACTION),
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
    const { sessions } = createServices(namespaces);

    await openSessionFromRequest({
      sessions,
      approvalId: "approval-1",
    });

    const firstPrepare = sessions.prepareSession({
      approvalId: "approval-1",
    });

    const secondPrepare = sessions.applyDraftEdit({
      approvalId: "approval-1",
      edit: {
        namespace: "eip155",
        changes: [{ field: "nonce", value: "0x8" }],
      },
    });

    stalePrepare.resolve({
      status: "ready",
      prepared: structuredClone(DEFAULT_UNSIGNED_TRANSACTION),
      reviewSnapshot: structuredClone(DEFAULT_UNSIGNED_TRANSACTION),
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
      reviewSnapshot: {
        ...structuredClone(DEFAULT_UNSIGNED_TRANSACTION),
        nonce: "0x8",
      },
    });
    const latestResult = await secondPrepare;

    expect(latestResult.prepare.status).toBe("ready");
    expect(latestResult.prepare.status === "ready" ? latestResult.prepare.approvedPayload : null).toMatchObject({
      nonce: "0x8",
    });
    expect(sessions.getSessionByApprovalId("approval-1")).toMatchObject({
      draft: {
        revision: 1,
      },
      prepare: {
        status: "ready",
      },
    });
  });

  it("returns approval_stale when approval uses an older prepare version", async () => {
    const namespaces = new NamespaceTransactions([["eip155", createNamespaceTransactionStub()]]);
    const { sessions } = createServices(namespaces);

    const opened = await openSessionFromRequest({
      sessions,
      approvalId: "approval-1",
    });
    const refreshed = await sessions.prepareSession({
      approvalId: "approval-1",
    });

    const stale = await sessions.approveTransaction({
      approvalId: "approval-1",
      expectedPrepareId: opened.prepare.prepareId,
    });

    expect(stale.status).toBe("approval_stale");
    expect(stale.status === "approval_stale" ? stale.session?.prepare.prepareId : null).toBe(
      refreshed.prepare.prepareId,
    );
  });

  it("returns approval_stale when the same prepare is approved again after success", async () => {
    const namespaces = new NamespaceTransactions([["eip155", createNamespaceTransactionStub()]]);
    const { sessions } = createServices(namespaces);

    const opened = await openSessionFromRequest({
      sessions,
      approvalId: "approval-1",
    });

    const approved = await sessions.approveTransaction({
      approvalId: "approval-1",
      expectedPrepareId: opened.prepare.prepareId,
    });
    expect(approved.status).toBe("approved");

    const replay = await sessions.approveTransaction({
      approvalId: "approval-1",
      expectedPrepareId: opened.prepare.prepareId,
    });

    expect(replay.status).toBe("approval_stale");
    expect(replay.status === "approval_stale" ? replay.session : undefined).toBeNull();
  });

  it("clears the previous review when a newer prepare run fails", async () => {
    const prepare = vi
      .fn()
      .mockResolvedValueOnce({
        status: "ready" as const,
        prepared: structuredClone(DEFAULT_UNSIGNED_TRANSACTION),
        reviewSnapshot: structuredClone(DEFAULT_UNSIGNED_TRANSACTION),
      })
      .mockRejectedValueOnce(new Error("rpc down"));
    const namespaces = new NamespaceTransactions([
      [
        "eip155",
        createNamespaceTransactionStub({
          prepare: prepare as never,
        }),
      ],
    ]);
    const { sessions } = createServices(namespaces);

    const opened = await openSessionFromRequest({
      sessions,
      approvalId: "approval-1",
    });
    expect(opened.review).not.toBeNull();

    const failed = await sessions.prepareSession({
      approvalId: "approval-1",
    });

    expect(failed.prepare.status).toBe("failed");
    expect(failed.review).toBeNull();
  });

  it("uses the local active nonce floor for wallet-managed approvals", async () => {
    const rpc = createEip155RpcClientStub();
    rpc.getTransactionCount = vi.fn().mockResolvedValue("0x7");
    const { sessions, tick } = createServices(createEip155Namespaces(rpc));

    const firstOpened = await openSessionFromRequest({
      sessions,
      approvalId: "approval-1",
      input: createTransactionInput({ requestId: "request-1" }),
    });
    tick(2_000);
    const firstApproved = await sessions.approveTransaction({
      approvalId: "approval-1",
      expectedPrepareId: firstOpened.prepare.prepareId,
    });
    expect(firstApproved.status).toBe("approved");

    const secondOpened = await openSessionFromRequest({
      sessions,
      approvalId: "approval-2",
      input: createTransactionInput({ requestId: "request-2" }),
    });
    tick(3_000);
    const secondApproved = await sessions.approveTransaction({
      approvalId: "approval-2",
      expectedPrepareId: secondOpened.prepare.prepareId,
    });

    expect(
      secondApproved.status === "approved" ? secondApproved.aggregate.record.approvedRequest?.payload : null,
    ).toMatchObject({
      nonce: "0x8",
    });
  });
});
