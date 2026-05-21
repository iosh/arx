import { ArxReasons, arxError } from "@arx/errors";
import { describe, expect, it, vi } from "vitest";
import { Messenger } from "../../messenger/Messenger.js";
import type { TransactionRecord } from "../../storage/records.js";
import {
  accountCodecs,
  createDefaultAccountKey,
  createNamespacesStub,
  createNamespaceTransactionStub,
  createPrepareStub,
  createProposalRuntime,
  createRecordViewStub,
  createTransactionProposal,
  createTransactionsServiceStub,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  DEFAULT_SUBMITTED,
  DEFAULT_TO,
  markReviewReady,
  REQUEST_CONTEXT,
  REQUEST_ID,
  toRecord,
} from "../__fixtures__/transactionServices.js";
import { TransactionProposalApprovalService } from "../proposal/TransactionProposalApprovalService.js";
import { TransactionRecordRuntime } from "../record/TransactionRecordRuntime.js";
import type { TransactionProposalMeta, TransactionRecordView } from "../runtime.js";
import { TRANSACTION_BROADCAST_STARTED, TRANSACTION_TOPICS } from "../topics.js";
import { TransactionExecutionPipeline } from "./TransactionExecutionPipeline.js";
import { TransactionExecutionService } from "./TransactionExecutionService.js";
import { TransactionSubmissionStore } from "./TransactionSubmissionStore.js";

const createTrackingStub = (params?: {
  start?: (id: string, context: unknown) => void;
  resume?: (id: string, context: unknown) => void;
  stop?: (id: string) => void;
  isTracking?: (id: string) => boolean;
}) =>
  ({
    start: params?.start ?? vi.fn(),
    resume: params?.resume ?? vi.fn(),
    stop: params?.stop ?? vi.fn(),
    isTracking: params?.isTracking ?? vi.fn(() => false),
    pending: vi.fn(() => 0),
  }) as never;

const createExecutionService = (params?: {
  proposalRuntime?: ReturnType<typeof createProposalRuntime>;
  namespaces?: ReturnType<typeof createNamespacesStub>;
  service?: ReturnType<typeof createTransactionsServiceStub>;
  prepare?: ReturnType<typeof createPrepareStub>;
  recordView?: ReturnType<typeof createRecordViewStub>;
  tracking?: ReturnType<typeof createTrackingStub>;
  messenger?: Messenger;
}) => {
  const proposalRuntime = params?.proposalRuntime ?? createProposalRuntime();
  const recordView = params?.recordView ?? createRecordViewStub();
  const service =
    params?.service ??
    createTransactionsServiceStub({
      createBroadcastRecord: vi.fn(async (input) => ({
        id: input.id ?? REQUEST_ID,
        namespace: "eip155",
        chainRef: input.chainRef,
        origin: input.origin,
        accountKey: input.accountKey,
        status: "broadcast" as const,
        submitted: input.submitted,
        receipt: null,
        replacementKey: null,
        replacedByRecordId: null,
        createdAt: input.createdAt ?? 1,
        updatedAt: input.createdAt ?? 1,
      })),
    });
  const prepare =
    params?.prepare ??
    createPrepareStub({
      prepareCurrentDraft: vi.fn(async () => {}),
    });
  const tracking = params?.tracking ?? createTrackingStub();
  const messenger = params?.messenger ?? new Messenger();
  const submissionService = new TransactionSubmissionStore({
    stateLimit: 50,
  });
  const recordService = new TransactionRecordRuntime({
    proposalRuntime,
    recordView,
    accountCodecs,
    namespaces: (params?.namespaces ?? createNamespacesStub()) as never,
    service,
    submission: submissionService,
    tracker: tracking as never,
  });
  const execution = new TransactionExecutionService({
    proposalApprovals: new TransactionProposalApprovalService({
      proposalRuntime,
      now: () => 1,
    }),
    proposalRuntime,
    pipeline: new TransactionExecutionPipeline({
      messenger: messenger.scope({ publish: TRANSACTION_TOPICS }),
      proposalRuntime,
      namespaces: (params?.namespaces ?? createNamespacesStub()) as never,
      submission: submissionService,
      records: recordService,
      now: () => 1,
    }),
    now: () => 1,
  });

  return {
    execution,
    recordService,
    proposalRuntime,
    recordView,
    service,
    submissionService,
    prepare,
    tracking,
    messenger,
  };
};

const createApprovedTransactionProposal = (
  proposalRuntime: ReturnType<typeof createProposalRuntime>,
  input?: Partial<TransactionProposalMeta>,
) =>
  createTransactionProposal(proposalRuntime, {
    prepared: { gas: "0x5208" },
    status: "approved",
    ...input,
  });

const createRecordView = (input: {
  id?: string;
  status: TransactionRecordView["status"];
  submitted?: TransactionRecordView["submitted"];
  receipt?: TransactionRecordView["receipt"];
  replacedByRecordId?: TransactionRecordView["replacedByRecordId"];
  updatedAt?: number;
}): TransactionRecordView => {
  return {
    kind: "record",
    id: input.id ?? REQUEST_ID,
    namespace: "eip155",
    chainRef: DEFAULT_CHAIN_REF,
    origin: REQUEST_CONTEXT.origin,
    accountAddress: DEFAULT_FROM,
    accountKey: createDefaultAccountKey(),
    status: input.status,
    submitted: input.submitted ?? DEFAULT_SUBMITTED,
    receipt: input.receipt ?? null,
    replacementKey: null,
    replacedByRecordId: input.replacedByRecordId ?? null,
    createdAt: 1,
    updatedAt: input.updatedAt ?? 1,
  };
};

describe("TransactionExecutionService", () => {
  it("enqueues approved proposals for execution", async () => {
    const proposalRuntime = createProposalRuntime();
    createTransactionProposal(proposalRuntime, {
      status: "active",
    });
    markReviewReady(proposalRuntime, REQUEST_ID, {
      executionPrepared: { gas: "0x5208" },
      reviewPreparedSnapshot: { gas: "0x5208" },
    });
    const { execution } = createExecutionService({
      proposalRuntime,
    });
    const executeApprovedTransaction = vi.fn(async () => {});
    const processSpy = vi.spyOn(execution, "executeApprovedTransaction").mockImplementation(executeApprovedTransaction);

    await expect(execution.approveTransaction(REQUEST_ID)).resolves.toMatchObject({
      status: "approved",
    });
    await Promise.resolve();

    expect(processSpy).toHaveBeenCalledWith(REQUEST_ID);
    processSpy.mockRestore();
  });

  it("does not enqueue failed proposal approvals", async () => {
    const { execution } = createExecutionService();
    const processSpy = vi.spyOn(execution, "executeApprovedTransaction").mockResolvedValue(undefined);

    await expect(execution.approveTransaction(REQUEST_ID)).resolves.toMatchObject({
      status: "failed",
      reason: "not_found",
    });
    await Promise.resolve();

    expect(processSpy).not.toHaveBeenCalled();
    processSpy.mockRestore();
  });

  it("fails with a stable namespace-transaction-missing error when execution reaches a namespace without a namespace transaction", async () => {
    const { execution, proposalRuntime } = createExecutionService({
      namespaces: createNamespacesStub(() => undefined),
    });
    createApprovedTransactionProposal(proposalRuntime);

    await execution.executeApprovedTransaction(REQUEST_ID);

    expect(proposalRuntime.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "terminated",
      termination: {
        reason: "execution_failed",
        error: {
          name: "NamespaceTransactionMissingError",
          message: "No namespace transaction registered for namespace eip155",
        },
        userRejected: false,
      },
    });
  });

  it("marks execution-stage user rejection as userRejected before broadcast", async () => {
    const { execution, proposalRuntime } = createExecutionService();
    createTransactionProposal(proposalRuntime, {
      prepared: {},
      status: "approved",
    });

    const rejectionError = Object.assign(new Error("User rejected transaction"), { code: 4001 });
    await execution.rejectTransaction({
      id: REQUEST_ID,
      reason: rejectionError,
      terminationReason: "user_rejected",
    });

    expect(proposalRuntime.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "terminated",
      termination: {
        reason: "user_rejected",
        userRejected: true,
        error: {
          name: "Error",
          message: "User rejected transaction",
          code: 4001,
        },
      },
    });
  });

  it("cancels a queued execution before processing starts", async () => {
    const proposalRuntime = createProposalRuntime();
    createTransactionProposal(proposalRuntime, {
      status: "active",
    });
    markReviewReady(proposalRuntime, REQUEST_ID, {
      executionPrepared: { gas: "0x5208" },
      reviewPreparedSnapshot: { gas: "0x5208" },
    });
    const { execution } = createExecutionService({
      proposalRuntime,
    });
    const processSpy = vi.spyOn(execution, "executeApprovedTransaction").mockResolvedValue(undefined);

    const approved = execution.approveTransaction(REQUEST_ID);
    await execution.rejectTransaction({
      id: REQUEST_ID,
      reason: new Error("Transport disconnected."),
      terminationReason: "approval_cancelled",
    });
    await expect(approved).resolves.toMatchObject({
      status: "approved",
    });
    await Promise.resolve();

    expect(processSpy).not.toHaveBeenCalled();
    expect(proposalRuntime.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "terminated",
      termination: {
        reason: "approval_cancelled",
        userRejected: false,
        error: {
          message: "Transport disconnected.",
        },
      },
    });

    processSpy.mockRestore();
  });

  it("does not rewrite a durable broadcast transaction when rejection happens after submission", async () => {
    const durableMeta = createRecordView({
      status: "broadcast",
      submitted: {
        hash: "0x1234",
        chainId: "0xa",
        from: DEFAULT_FROM,
        nonce: "0x7",
      },
    });
    const commitRecordView = vi.fn((record: TransactionRecord) => {
      return {
        next: createRecordView({
          status: durableMeta.status,
          submitted: durableMeta.submitted,
          updatedAt: record.updatedAt,
        }),
      };
    });
    const stop = vi.fn();
    const resume = vi.fn();
    const { execution } = createExecutionService({
      service: createTransactionsServiceStub({
        get: vi.fn(async () =>
          toRecord(
            {
              id: durableMeta.id,
              namespace: durableMeta.namespace,
              chainRef: durableMeta.chainRef,
              origin: durableMeta.origin,
              from: durableMeta.accountAddress,
              createdAt: durableMeta.createdAt,
              updatedAt: durableMeta.updatedAt,
            },
            "broadcast",
          ),
        ),
      }),
      recordView: createRecordViewStub({
        commitRecordView,
      }),
      tracking: createTrackingStub({
        stop,
        resume,
      }),
    });

    await execution.rejectTransaction({
      id: REQUEST_ID,
      reason: new Error("Transport disconnected."),
      terminationReason: "approval_cancelled",
    });

    expect(stop).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it("creates a durable record only after broadcast succeeds", async () => {
    const signTransaction = vi.fn(async () => ({
      raw: "0x1111",
    }));
    const broadcastTransaction = vi.fn(async () => ({
      submitted: {
        hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
        chainId: "0xa",
        from: DEFAULT_FROM,
        nonce: "0x7",
      },
    }));
    const createBroadcastRecord = vi.fn(async (input) => ({
      id: input.id ?? REQUEST_ID,
      namespace: "eip155",
      chainRef: input.chainRef,
      origin: input.origin,
      accountKey: input.accountKey,
      status: "broadcast" as const,
      submitted: input.submitted,
      receipt: null,
      replacementKey: null,
      replacedByRecordId: null,
      createdAt: input.createdAt ?? 1,
      updatedAt: input.createdAt ?? 1,
    }));
    const start = vi.fn();
    const recordView = createRecordViewStub();
    const { execution, proposalRuntime } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: signTransaction as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
      service: createTransactionsServiceStub({
        createBroadcastRecord,
      }),
      recordView,
      tracking: createTrackingStub({
        start,
      }),
    });

    createApprovedTransactionProposal(proposalRuntime, {
      request: {
        namespace: "eip155",
        chainRef: DEFAULT_CHAIN_REF,
        payload: {
          from: DEFAULT_FROM,
          to: DEFAULT_TO,
          value: "0x0",
          data: "0x",
          nonce: "0x7",
        },
      },
      prepared: {
        nonce: "0x7",
      },
    });

    await execution.executeApprovedTransaction(REQUEST_ID);

    expect(signTransaction).toHaveBeenCalledTimes(1);
    expect(broadcastTransaction).toHaveBeenCalledTimes(1);
    expect(createBroadcastRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: REQUEST_ID,
        submitted: {
          hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
          chainId: "0xa",
          from: DEFAULT_FROM,
          nonce: "0x7",
        },
      }),
    );
    expect(proposalRuntime.get(REQUEST_ID)).toBeUndefined();
    expect(recordView.commitRecordView).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("does not create a durable record when broadcast fails", async () => {
    const broadcastError = new Error("RPC unavailable");
    const createBroadcastRecord = vi.fn();
    const { execution, proposalRuntime } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          broadcast: vi.fn(async () => {
            throw broadcastError;
          }) as never,
        }),
      ),
      service: createTransactionsServiceStub({
        createBroadcastRecord: createBroadcastRecord as never,
      }),
    });
    createApprovedTransactionProposal(proposalRuntime);

    await execution.executeApprovedTransaction(REQUEST_ID);

    expect(createBroadcastRecord).not.toHaveBeenCalled();
    expect(proposalRuntime.get(REQUEST_ID)).toMatchObject({
      status: "terminated",
      termination: {
        reason: "execution_failed",
        error: {
          message: "RPC unavailable",
        },
        userRejected: false,
      },
    });
  });

  it("classifies broadcast-stage user rejection as user_rejected", async () => {
    const broadcastError = Object.assign(new Error("User rejected"), { code: 4001 });
    const createBroadcastRecord = vi.fn();
    const { execution, proposalRuntime } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          broadcast: vi.fn(async () => {
            throw broadcastError;
          }) as never,
        }),
      ),
      service: createTransactionsServiceStub({
        createBroadcastRecord: createBroadcastRecord as never,
      }),
    });
    createApprovedTransactionProposal(proposalRuntime);

    await execution.executeApprovedTransaction(REQUEST_ID);

    expect(createBroadcastRecord).not.toHaveBeenCalled();
    expect(proposalRuntime.get(REQUEST_ID)).toMatchObject({
      status: "terminated",
      termination: {
        reason: "user_rejected",
        error: {
          message: "User rejected",
          code: 4001,
        },
        userRejected: true,
      },
    });
  });

  it("does not create a durable record when signing fails", async () => {
    const signError = new Error("Signer failed");
    const createBroadcastRecord = vi.fn();
    const broadcastTransaction = vi.fn();
    const { execution, proposalRuntime } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: vi.fn(async () => {
            throw signError;
          }) as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
      service: createTransactionsServiceStub({
        createBroadcastRecord: createBroadcastRecord as never,
      }),
    });
    createApprovedTransactionProposal(proposalRuntime);

    await execution.executeApprovedTransaction(REQUEST_ID);

    expect(broadcastTransaction).not.toHaveBeenCalled();
    expect(createBroadcastRecord).not.toHaveBeenCalled();
    expect(proposalRuntime.get(REQUEST_ID)).toMatchObject({
      status: "terminated",
      termination: {
        reason: "execution_failed",
        error: {
          message: "Signer failed",
        },
        userRejected: false,
      },
    });
  });

  it("classifies signing-stage user rejection as user_rejected", async () => {
    const signError = Object.assign(new Error("User rejected"), { code: 4001 });
    const createBroadcastRecord = vi.fn();
    const broadcastTransaction = vi.fn();
    const { execution, proposalRuntime } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: vi.fn(async () => {
            throw signError;
          }) as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
      service: createTransactionsServiceStub({
        createBroadcastRecord: createBroadcastRecord as never,
      }),
    });
    createApprovedTransactionProposal(proposalRuntime);

    await execution.executeApprovedTransaction(REQUEST_ID);

    expect(broadcastTransaction).not.toHaveBeenCalled();
    expect(createBroadcastRecord).not.toHaveBeenCalled();
    expect(proposalRuntime.get(REQUEST_ID)).toMatchObject({
      status: "terminated",
      termination: {
        reason: "user_rejected",
        error: {
          message: "User rejected",
          code: 4001,
        },
        userRejected: true,
      },
    });
  });

  it("records submission persistence failure without keeping the proposal alive after broadcast", async () => {
    const { execution, proposalRuntime, submissionService } = createExecutionService({
      service: createTransactionsServiceStub({
        createBroadcastRecord: vi.fn(async () => {
          throw new Error("Local transaction store unavailable");
        }),
      }),
    });
    createApprovedTransactionProposal(proposalRuntime);

    await execution.executeApprovedTransaction(REQUEST_ID);

    expect(proposalRuntime.get(REQUEST_ID)).toBeUndefined();
    await expect(submissionService.waitForSubmissionOutcome(REQUEST_ID)).resolves.toMatchObject({
      submitted: DEFAULT_SUBMITTED,
      persistenceFailure: {
        transactionId: REQUEST_ID,
        error: {
          name: "TransactionPersistenceError",
          message: "Transaction was broadcast but could not be persisted locally.",
          data: {
            cause: {
              name: "Error",
              message: "Local transaction store unavailable",
            },
            transactionId: REQUEST_ID,
            submitted: DEFAULT_SUBMITTED,
          },
        },
      },
    });
  });

  it("does not revive a rejected proposal after async signing resolves", async () => {
    const { promise: signStarted, resolve: releaseSign } = Promise.withResolvers<void>();
    const signTransaction = vi.fn(async () => {
      await signStarted;
      return { raw: "0x1111" };
    });
    const broadcastTransaction = vi.fn(async () => ({
      submitted: DEFAULT_SUBMITTED,
    }));

    const { execution, proposalRuntime } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: signTransaction as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
    });
    createApprovedTransactionProposal(proposalRuntime);

    const processing = execution.executeApprovedTransaction(REQUEST_ID);
    await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(1));

    await execution.rejectTransaction({
      id: REQUEST_ID,
      reason: new Error("User cancelled before submission"),
      terminationReason: "approval_cancelled",
    });
    releaseSign();
    await processing;

    expect(proposalRuntime.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "terminated",
      termination: {
        reason: "approval_cancelled",
        error: {
          message: "User cancelled before submission",
        },
        userRejected: false,
      },
    });
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it("aborts an in-flight signing attempt when external cancellation arrives", async () => {
    let observedSignal: AbortSignal | null = null;
    const { promise: signBlocked, resolve: releaseSign } = Promise.withResolvers<void>();
    const signTransaction = vi.fn(async (_context, _prepared, options?: { signal?: AbortSignal }) => {
      observedSignal = options?.signal ?? null;
      await signBlocked;
      if (observedSignal?.aborted) {
        throw (observedSignal.reason as Error) ?? new Error("Transaction signing aborted.");
      }
      return { raw: "0x1111" };
    });
    const broadcastTransaction = vi.fn(async () => ({
      submitted: DEFAULT_SUBMITTED,
    }));

    const { execution, proposalRuntime } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: signTransaction as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
    });
    createApprovedTransactionProposal(proposalRuntime);

    const processing = execution.executeApprovedTransaction(REQUEST_ID);
    await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(1));

    await execution.rejectTransaction({
      id: REQUEST_ID,
      reason: new Error("User cancelled before submission"),
      terminationReason: "approval_cancelled",
    });
    expect((observedSignal as unknown as AbortSignal).aborted).toBe(true);

    releaseSign();
    await processing;

    expect(proposalRuntime.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "terminated",
      termination: {
        reason: "approval_cancelled",
        error: {
          message: "User cancelled before submission",
        },
        userRejected: false,
      },
    });
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it("treats the broadcast-started event as already irreversible for cancellation races", async () => {
    const messenger = new Messenger();
    const signTransaction = vi.fn(async () => ({ raw: "0x1111" }));
    const broadcastTransaction = vi.fn(async () => ({
      submitted: DEFAULT_SUBMITTED,
    }));
    const createBroadcastRecord = vi.fn(async (input) => ({
      id: input.id ?? REQUEST_ID,
      namespace: "eip155",
      chainRef: input.chainRef,
      origin: input.origin,
      accountKey: input.accountKey,
      status: "broadcast" as const,
      submitted: input.submitted,
      receipt: null,
      replacementKey: null,
      replacedByRecordId: null,
      createdAt: input.createdAt ?? 1,
      updatedAt: input.createdAt ?? 1,
    }));
    const recordView = createRecordViewStub();
    const { execution, proposalRuntime } = createExecutionService({
      messenger,
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: signTransaction as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
      service: createTransactionsServiceStub({
        createBroadcastRecord,
      }),
      recordView,
    });
    createApprovedTransactionProposal(proposalRuntime);

    messenger.subscribe(TRANSACTION_BROADCAST_STARTED, ({ id }) => {
      void execution.rejectTransaction({
        id,
        reason: new Error("User cancelled too late"),
        terminationReason: "approval_cancelled",
      });
    });

    await execution.executeApprovedTransaction(REQUEST_ID);

    expect(createBroadcastRecord).toHaveBeenCalledTimes(1);
    expect(proposalRuntime.get(REQUEST_ID)).toBeUndefined();
    expect(recordView.commitRecordView).toHaveBeenCalledTimes(1);
  });

  it("keeps the broadcast result when rejection races after broadcast has started", async () => {
    const { promise: broadcastStarted, resolve: releaseBroadcast } = Promise.withResolvers<void>();
    const signTransaction = vi.fn(async () => ({ raw: "0x1111" }));
    const broadcastTransaction = vi.fn(async () => {
      await broadcastStarted;
      return {
        submitted: DEFAULT_SUBMITTED,
      };
    });
    const createBroadcastRecord = vi.fn(async (input) => ({
      id: input.id ?? REQUEST_ID,
      namespace: "eip155",
      chainRef: input.chainRef,
      origin: input.origin,
      accountKey: input.accountKey,
      status: "broadcast" as const,
      submitted: input.submitted,
      receipt: null,
      replacementKey: null,
      replacedByRecordId: null,
      createdAt: input.createdAt ?? 1,
      updatedAt: input.createdAt ?? 1,
    }));

    const recordView = createRecordViewStub();
    const { execution, proposalRuntime } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: signTransaction as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
      service: createTransactionsServiceStub({
        createBroadcastRecord,
      }),
      recordView,
    });
    createApprovedTransactionProposal(proposalRuntime);

    const processing = execution.executeApprovedTransaction(REQUEST_ID);
    await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(broadcastTransaction).toHaveBeenCalledTimes(1));

    await execution.rejectTransaction({
      id: REQUEST_ID,
      reason: new Error("User cancelled too late"),
      terminationReason: "approval_cancelled",
    });
    releaseBroadcast();
    await processing;

    expect(createBroadcastRecord).toHaveBeenCalledTimes(1);
    expect(proposalRuntime.get(REQUEST_ID)).toBeUndefined();
    expect(recordView.commitRecordView).toHaveBeenCalledTimes(1);
  });

  it("keeps the broadcast result when rejection races during durable persistence", async () => {
    const { promise: persistenceStartedPromise, resolve: persistenceStarted } = Promise.withResolvers<void>();
    const { promise: persistenceBlocked, resolve: releasePersistence } = Promise.withResolvers<void>();
    const signTransaction = vi.fn(async () => ({ raw: "0x1111" }));
    const broadcastTransaction = vi.fn(async () => ({
      submitted: DEFAULT_SUBMITTED,
    }));
    const createBroadcastRecord = vi.fn(async (input) => {
      persistenceStarted();
      await persistenceBlocked;
      return {
        id: input.id ?? REQUEST_ID,
        namespace: "eip155",
        chainRef: input.chainRef,
        origin: input.origin,
        accountKey: input.accountKey,
        status: "broadcast" as const,
        submitted: input.submitted,
        receipt: null,
        replacementKey: null,
        replacedByRecordId: null,
        createdAt: input.createdAt ?? 1,
        updatedAt: input.createdAt ?? 1,
      };
    });

    const recordView = createRecordViewStub();
    const { execution, proposalRuntime } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: signTransaction as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
      service: createTransactionsServiceStub({
        createBroadcastRecord,
      }),
      recordView,
    });
    createApprovedTransactionProposal(proposalRuntime);

    const processing = execution.executeApprovedTransaction(REQUEST_ID);
    await persistenceStartedPromise;

    await execution.rejectTransaction({
      id: REQUEST_ID,
      reason: new Error("User cancelled after submission"),
      terminationReason: "approval_cancelled",
    });
    releasePersistence();
    await processing;

    expect(createBroadcastRecord).toHaveBeenCalledTimes(1);
    expect(proposalRuntime.get(REQUEST_ID)).toBeUndefined();
    expect(recordView.commitRecordView).toHaveBeenCalledTimes(1);
  });

  it("re-enqueues approved proposals when resuming approved proposals", async () => {
    const { execution, proposalRuntime } = createExecutionService();
    createApprovedTransactionProposal(proposalRuntime);
    const executeApprovedTransaction = vi.fn(async () => {});
    const processSpy = vi.spyOn(execution, "executeApprovedTransaction").mockImplementation(executeApprovedTransaction);

    await execution.resumeApprovedProposals();
    await Promise.resolve();

    expect(processSpy).toHaveBeenCalledWith(REQUEST_ID);
    processSpy.mockRestore();
  });

  it("fails proposals when signing is interrupted by lock", async () => {
    const lockError = arxError({
      reason: ArxReasons.SessionLocked,
      message: "Wallet is locked.",
    });
    const broadcastTransaction = vi.fn();
    const { execution, proposalRuntime } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: vi.fn(async () => {
            throw lockError;
          }) as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
    });
    createApprovedTransactionProposal(proposalRuntime);

    await execution.executeApprovedTransaction(REQUEST_ID);

    expect(proposalRuntime.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "terminated",
      termination: {
        reason: "execution_failed",
        userRejected: false,
        error: {
          name: "ArxError",
          message: "Wallet is locked.",
        },
      },
    });
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it("fails approved transactions that are missing prepared params", async () => {
    const proposalRuntime = createProposalRuntime();
    createTransactionProposal(proposalRuntime, {
      status: "active",
    });
    const state = proposalRuntime.peek(REQUEST_ID);
    if (!state) {
      throw new Error("Proposal not found");
    }
    state.status = "approved";
    state.prepare = {
      requestRevision: state.prepare.requestRevision,
      sessionToken: "broken-session",
      updatedAt: state.updatedAt,
      status: "preparing",
      prepared: null,
    };
    const signTransaction = vi.fn(async () => ({ raw: "0x1111" }));
    const { execution } = createExecutionService({
      proposalRuntime,
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: signTransaction as never,
        }),
      ),
    });

    await execution.executeApprovedTransaction(REQUEST_ID);

    expect(signTransaction).not.toHaveBeenCalled();
    expect(proposalRuntime.get(REQUEST_ID)).toMatchObject({
      status: "terminated",
      termination: {
        reason: "execution_failed",
        error: {
          message: "Approved transaction is missing prepared execution parameters.",
        },
        userRejected: false,
      },
    });
  });
});
