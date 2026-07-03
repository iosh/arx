import { describe, expect, it, vi } from "vitest";
import {
  APPROVAL_ID,
  accountAddressing,
  createDefaultAccountId,
  createNamespaceTransactionStub,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  DEFAULT_TO,
} from "./__fixtures__/transactionServices.js";
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
import { buildTransactionTerminalReason } from "./aggregate/index.js";
import { TransactionAggregateStore } from "./aggregate/TransactionAggregateStore.js";
import { createTransactionServices } from "./createTransactionServices.js";
import { NamespaceTransactions } from "./namespace/NamespaceTransactions.js";
import type { ApproveTransactionResult, Transaction } from "./TransactionsService.js";
import type { NamespaceTransactionDraftEdit } from "./types.js";

const cloneAggregate = (aggregate: TransactionAggregate): TransactionAggregate => structuredClone(aggregate);

const compareRecordsNewestFirst = (left: TransactionRecord, right: TransactionRecord): number =>
  right.createdAt - left.createdAt || right.id.localeCompare(left.id);

type CreateTransactionInputOverrides = Omit<Partial<CreateTransactionInput>, "request"> & {
  request?: {
    payload?: JsonValue;
  };
};

const createTransactionInput = (overrides: CreateTransactionInputOverrides = {}): CreateTransactionInput => ({
  namespace: overrides.namespace ?? "eip155",
  chainRef: overrides.chainRef ?? DEFAULT_CHAIN_REF,
  origin: overrides.origin ?? "https://dapp.example",
  source: overrides.source ?? "provider",
  requestId: overrides.requestId ?? "request-1",
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
  ...(overrides.replacement !== undefined ? { replacement: overrides.replacement } : {}),
});

const createInMemoryTransactionsStoragePort = (seed: TransactionAggregate[] = []): TransactionsStoragePort => {
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
      if (store.has(aggregate.record.id)) {
        throw new Error(`Duplicate aggregate "${aggregate.record.id}"`);
      }
      store.set(aggregate.record.id, cloneAggregate(aggregate));
    },
    async saveTransactionAggregate(aggregate) {
      if (!store.has(aggregate.record.id)) {
        throw new Error(`Missing aggregate "${aggregate.record.id}"`);
      }
      store.set(aggregate.record.id, cloneAggregate(aggregate));
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

  return port;
};

const createHarness = (params?: {
  applyDraftEdit?: (context: { edit: NamespaceTransactionDraftEdit }) => CreateTransactionInput["request"];
  broadcast?: (...args: never[]) => unknown;
}) => {
  let nextTransactionId = 0;
  let nextPrepareId = 0;
  const storage = createInMemoryTransactionsStoragePort();
  const aggregateStore = new TransactionAggregateStore({
    transactionsPort: storage,
    now: () => 1_000,
    createId: () => {
      nextTransactionId += 1;
      return `tx-${nextTransactionId}`;
    },
  });
  const namespace = createNamespaceTransactionStub({
    ...(params?.applyDraftEdit
      ? {
          applyDraftEdit: params.applyDraftEdit as never,
        }
      : {}),
    ...(params?.broadcast
      ? {
          broadcast: params.broadcast as never,
        }
      : {}),
  });
  const namespaces = new NamespaceTransactions([["eip155", namespace]]);
  const services = createTransactionServices({
    aggregateStore,
    namespaces,
    accountAddressing,
    approvalSessionOptions: {
      now: () => 1_000,
      createId: () => {
        nextPrepareId += 1;
        return `prepare-${nextPrepareId}`;
      },
    },
  });

  return {
    services,
  };
};

const requireApprovedTransaction = (result: ApproveTransactionResult): Transaction => {
  if (result.status !== "approved") {
    throw new Error("Expected transaction approval to succeed.");
  }

  return result.transaction;
};

describe("TransactionsService", () => {
  it("opens an approval without creating durable transaction history", async () => {
    const { services } = createHarness();
    const transactionChanges: string[][] = [];
    const approvalChanges: string[][] = [];
    services.transactions.onTransactionsChanged((ids) => transactionChanges.push(ids));
    services.transactions.onTransactionApprovalsChanged((ids) => approvalChanges.push(ids));

    const result = await services.transactions.requestTransactionApproval({
      ...createTransactionInput(),
      approvalId: APPROVAL_ID,
    });

    expect(result).toEqual({
      approval: expect.objectContaining({
        approvalId: APPROVAL_ID,
        namespace: "eip155",
        chainRef: DEFAULT_CHAIN_REF,
        source: "provider",
        origin: "https://dapp.example",
        account: {
          accountId: createDefaultAccountId(),
          address: DEFAULT_FROM,
        },
        prepare: expect.objectContaining({
          id: "prepare-1",
          status: "ready",
        }),
      }),
      decision: expect.any(Promise),
    });
    expect(result.approval).not.toHaveProperty("draft");
    expect(result.approval.prepare).not.toHaveProperty("approvedPayload");
    expect("getTransactionCapabilities" in services.transactions).toBe(false);
    await expect(services.transactions.listTransactions()).resolves.toEqual([]);
    expect(transactionChanges).toEqual([]);
    expect(approvalChanges).toEqual([[APPROVAL_ID]]);
  });

  it("uses approvalId for approval commands and creates the durable transaction after approval", async () => {
    const { services } = createHarness();
    const transactionChanges: string[][] = [];
    const approvalChanges: string[][] = [];
    services.transactions.onTransactionsChanged((ids) => transactionChanges.push(ids));
    services.transactions.onTransactionApprovalsChanged((ids) => approvalChanges.push(ids));
    const opened = await services.transactions.requestTransactionApproval({
      ...createTransactionInput(),
      approvalId: APPROVAL_ID,
    });

    const approved = await services.transactions.approveTransaction({
      approvalId: APPROVAL_ID,
      expectedPrepareId: opened.approval.prepare.id,
    });

    expect(approved).toMatchObject({
      status: "approved",
      transaction: {
        id: "tx-1",
        status: "submitting",
        namespace: "eip155",
        chainRef: DEFAULT_CHAIN_REF,
        source: "provider",
        origin: "https://dapp.example",
        account: {
          accountId: createDefaultAccountId(),
          address: DEFAULT_FROM,
        },
        submitted: null,
        receipt: null,
        replacement: null,
        terminalReason: null,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
    });
    const transaction = requireApprovedTransaction(approved);
    expect(transaction).not.toHaveProperty("request");
    expect(transaction).not.toHaveProperty("approvedRequest");
    expect(transaction).not.toHaveProperty("conflictKey");
    expect(transaction).not.toHaveProperty("activeSubmissionId");
    expect(services.transactions.getTransactionApproval(APPROVAL_ID)).toBeNull();
    await expect(services.transactions.getTransaction("tx-1")).resolves.toEqual(transaction);
    await expect(opened.decision).resolves.toMatchObject({
      status: "approved",
      approvalId: APPROVAL_ID,
      transaction: {
        id: "tx-1",
      },
    });
    expect(transactionChanges).toEqual([["tx-1"]]);
    expect(approvalChanges).toEqual([[APPROVAL_ID], [APPROVAL_ID]]);
  });

  it("approves and submits through one service call", async () => {
    const { services } = createHarness();
    const opened = await services.transactions.requestTransactionApproval({
      ...createTransactionInput(),
      approvalId: APPROVAL_ID,
    });

    const submitted = await services.transactions.approveAndSubmitTransaction({
      approvalId: APPROVAL_ID,
      expectedPrepareId: opened.approval.prepare.id,
    });

    expect(submitted).toMatchObject({
      status: "submitted",
      transaction: {
        id: "tx-1",
        status: "submitted",
        submitted: {
          hash: "0xdeadbeef",
        },
      },
    });
    expect(services.transactions.getTransactionApproval(APPROVAL_ID)).toBeNull();
  });

  it("keeps the failed transaction visible when submit fails", async () => {
    const broadcast = vi.fn(async () => {
      throw new Error("RPC unavailable");
    });
    const { services } = createHarness({ broadcast });
    const opened = await services.transactions.requestTransactionApproval({
      ...createTransactionInput(),
      approvalId: APPROVAL_ID,
    });

    await expect(
      services.transactions.approveAndSubmitTransaction({
        approvalId: APPROVAL_ID,
        expectedPrepareId: opened.approval.prepare.id,
      }),
    ).rejects.toThrow("RPC unavailable");

    expect(broadcast).toHaveBeenCalledOnce();
    await expect(services.transactions.getTransaction("tx-1")).resolves.toMatchObject({
      id: "tx-1",
      status: "failed",
      submitted: null,
      terminalReason: expect.objectContaining({
        kind: "broadcast_failed",
        message: "RPC unavailable",
      }),
    });
  });

  it("rejects a reused approvalId before creating a durable transaction", async () => {
    const { services } = createHarness();
    await services.transactions.requestTransactionApproval({
      ...createTransactionInput(),
      approvalId: APPROVAL_ID,
    });

    await expect(
      services.transactions.requestTransactionApproval({
        ...createTransactionInput({
          requestId: "request-2",
        }),
        approvalId: APPROVAL_ID,
      }),
    ).rejects.toMatchObject({
      name: "TransactionApprovalSessionInvariantError",
    });
    await expect(services.transactions.listTransactions()).resolves.toEqual([]);
  });

  it("lists public transaction history with filters and cloned JSON summaries", async () => {
    const { services } = createHarness();
    const secondAccountId = createDefaultAccountId({
      from: "0xcccccccccccccccccccccccccccccccccccccccc",
    });
    const first = await services.transactions.requestTransactionApproval({
      ...createTransactionInput({
        requestId: "request-1",
      }),
      approvalId: "approval-1",
    });
    await services.transactions.approveTransaction({
      approvalId: "approval-1",
      expectedPrepareId: first.approval.prepare.id,
    });
    const opened = await services.transactions.requestTransactionApproval({
      ...createTransactionInput({
        requestId: "request-2",
        accountId: secondAccountId,
      }),
      approvalId: "approval-2",
    });
    const submitted = await services.transactions.approveAndSubmitTransaction({
      approvalId: "approval-2",
      expectedPrepareId: opened.approval.prepare.id,
    });
    expect(submitted.status).toBe("submitted");

    const submittedHistory = await services.transactions.listTransactions({
      status: "submitted",
      accountId: secondAccountId,
    });

    expect(submittedHistory).toHaveLength(1);
    expect(submittedHistory[0]).toMatchObject({
      id: "tx-3",
      status: "submitted",
      submitted: {
        hash: "0xdeadbeef",
      },
    });
    expect(submittedHistory[0]).not.toHaveProperty("request");
    expect(submittedHistory[0]).not.toHaveProperty("approvedRequest");
    expect(submittedHistory[0]).not.toHaveProperty("conflictKey");

    const submittedSummary = submittedHistory[0]?.submitted as { hash: string };
    submittedSummary.hash = "mutated";
    await expect(services.transactions.getTransaction("tx-3")).resolves.toMatchObject({
      submitted: {
        hash: "0xdeadbeef",
      },
    });

    await expect(
      services.transactions.listTransactions({
        before: {
          createdAt: 1_000,
          id: "tx-1",
        },
      }),
    ).resolves.toEqual([]);
  });

  it("ignores transaction listener failures and honors unsubscribe after approval creates a transaction", async () => {
    const { services } = createHarness();
    const changes: string[][] = [];
    const unsubscribeThrowing = services.transactions.onTransactionsChanged(() => {
      throw new Error("listener failed");
    });
    const unsubscribe = services.transactions.onTransactionsChanged((ids) => {
      changes.push(ids);
    });

    const opened = await services.transactions.requestTransactionApproval({
      ...createTransactionInput(),
      approvalId: APPROVAL_ID,
    });
    await services.transactions.approveTransaction({
      approvalId: APPROVAL_ID,
      expectedPrepareId: opened.approval.prepare.id,
    });
    unsubscribeThrowing();
    unsubscribe();
    const second = await services.transactions.requestTransactionApproval({
      ...createTransactionInput({ requestId: "request-2" }),
      approvalId: "approval-2",
    });
    await services.transactions.approveTransaction({
      approvalId: "approval-2",
      expectedPrepareId: second.approval.prepare.id,
    });

    expect(changes).toEqual([["tx-1"]]);
  });

  it("updates and reruns an approval by approvalId", async () => {
    const applyDraftEdit = vi.fn((context: { edit: NamespaceTransactionDraftEdit }) => ({
      namespace: "eip155",
      chainRef: DEFAULT_CHAIN_REF,
      payload: {
        from: DEFAULT_FROM,
        to: DEFAULT_TO,
        value: (context.edit as { value: string }).value,
        data: "0x",
      },
    }));
    const { services } = createHarness({ applyDraftEdit });
    await services.transactions.requestTransactionApproval({
      ...createTransactionInput(),
      approvalId: APPROVAL_ID,
    });

    const edited = await services.transactions.updateApprovalDraft({
      approvalId: APPROVAL_ID,
      edit: {
        value: "0x2",
      } as NamespaceTransactionDraftEdit,
    });
    const rerun = await services.transactions.rerunApprovalPrepare({ approvalId: APPROVAL_ID });

    expect(applyDraftEdit).toHaveBeenCalledOnce();
    expect(edited.prepare).toMatchObject({
      status: "ready",
      draftRevision: 1,
    });
    expect(rerun.prepare).toMatchObject({
      status: "ready",
      draftRevision: 1,
    });
  });

  it("rejects an approval without creating transaction history", async () => {
    const { services } = createHarness();
    const opened = await services.transactions.requestTransactionApproval({
      ...createTransactionInput(),
      approvalId: APPROVAL_ID,
    });

    const rejected = await services.transactions.rejectTransactionApproval({
      approvalId: APPROVAL_ID,
      reason: null,
    });

    expect(rejected).toMatchObject({
      approvalId: opened.approval.approvalId,
    });
    await expect(opened.decision).resolves.toMatchObject({
      status: "rejected",
      approvalId: APPROVAL_ID,
      reason: null,
    });
    expect(services.transactions.getTransactionApproval(APPROVAL_ID)).toBeNull();
    await expect(services.transactions.listTransactions()).resolves.toEqual([]);
  });

  it("cancels an approval without creating transaction history", async () => {
    const { services } = createHarness();
    const opened = await services.transactions.requestTransactionApproval({
      ...createTransactionInput(),
      approvalId: APPROVAL_ID,
    });

    const cancelled = await services.transactions.cancelTransactionApproval({
      approvalId: APPROVAL_ID,
      reason: null,
    });

    expect(cancelled).toMatchObject({
      approvalId: APPROVAL_ID,
    });
    await expect(opened.decision).resolves.toMatchObject({
      status: "cancelled",
      approvalId: APPROVAL_ID,
      reason: null,
    });
    expect(services.transactions.getTransactionApproval(APPROVAL_ID)).toBeNull();
    await expect(services.transactions.listTransactions()).resolves.toEqual([]);
  });

  it("creates replacement approval views and writes replacement metadata only after approval", async () => {
    const { services } = createHarness();

    const replacement = await services.transactions.createSpeedUpReplacement({
      ...createTransactionInput({
        requestId: "request-2",
      }),
      approvalId: "replacement-approval",
      transactionId: "tx-original",
    });

    expect(replacement.approval).toMatchObject({
      approvalId: "replacement-approval",
    });
    await expect(services.transactions.listTransactions()).resolves.toEqual([]);

    const approved = await services.transactions.approveTransaction({
      approvalId: "replacement-approval",
      expectedPrepareId: replacement.approval.prepare.id,
    });

    expect(approved).toMatchObject({
      status: "approved",
      transaction: {
        id: "tx-1",
        replacement: {
          replaces: {
            transactionId: "tx-original",
            type: "speed_up",
          },
          replacedBy: null,
        },
      },
    });
    expect("getTransactionCapabilities" in services.transactions).toBe(false);
  });

  it("returns approval_stale when an approval command cannot find an active session", async () => {
    const { services } = createHarness();

    await expect(
      services.transactions.approveTransaction({
        approvalId: "missing-approval",
        expectedPrepareId: "prepare-1",
      }),
    ).resolves.toMatchObject({
      status: "approval_stale",
      approval: null,
    });
  });

  it("cancels an approval decision when the bound lifecycle signal aborts", async () => {
    const { services } = createHarness();
    const controller = new AbortController();
    const opened = await services.transactions.requestTransactionApproval({
      ...createTransactionInput(),
      approvalId: APPROVAL_ID,
      cancellation: {
        signal: controller.signal,
        reason: buildTransactionTerminalReason({
          kind: "approval_cancelled",
          code: "test.lifecycle_aborted",
          message: "Test lifecycle ended.",
        }),
      },
    });

    controller.abort(new Error("request ended"));

    await expect(opened.decision).resolves.toMatchObject({
      status: "cancelled",
      approvalId: APPROVAL_ID,
      reason: expect.objectContaining({
        code: "test.lifecycle_aborted",
      }),
    });
    expect(services.transactions.getTransactionApproval(APPROVAL_ID)).toBeNull();
    await expect(services.transactions.listTransactions()).resolves.toEqual([]);
  });
});
