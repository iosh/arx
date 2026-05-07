import { ArxReasons, arxError } from "@arx/errors";
import { describe, expect, it, vi } from "vitest";
import { Messenger } from "../../messenger/Messenger.js";
import type { TransactionRecord } from "../../storage/records.js";
import {
  accountCodecs,
  createNamespacesStub,
  createNamespaceTransactionStub,
  createPrepareStub,
  createProposalStore,
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
} from "./__fixtures__/transactionServices.js";
import { TransactionExecutionPipeline } from "./TransactionExecutionPipeline.js";
import { TransactionExecutionService } from "./TransactionExecutionService.js";
import { TransactionRecordService } from "./TransactionRecordService.js";
import { TransactionSubmissionStore } from "./TransactionSubmissionStore.js";
import { TRANSACTION_BROADCAST_STARTED, TRANSACTION_TOPICS } from "./topics.js";
import type { TransactionProposalMeta, TransactionRecordView } from "./types.js";

const createTrackingStub = (params?: {
  stop?: (id: string) => void;
  handleTransition?: (previous: TransactionRecordView | undefined, next: TransactionRecordView) => void;
  resumeBroadcast?: (record: TransactionRecordView) => void;
}) =>
  ({
    stop: params?.stop ?? vi.fn(),
    handleTransition: params?.handleTransition ?? vi.fn(),
    resumeBroadcast: params?.resumeBroadcast ?? vi.fn(),
  }) as never;

const createExecutionService = (params?: {
  proposalStore?: ReturnType<typeof createProposalStore>;
  namespaces?: ReturnType<typeof createNamespacesStub>;
  service?: ReturnType<typeof createTransactionsServiceStub>;
  prepare?: ReturnType<typeof createPrepareStub>;
  recordView?: ReturnType<typeof createRecordViewStub>;
  tracking?: ReturnType<typeof createTrackingStub>;
  messenger?: Messenger;
}) => {
  const proposalStore = params?.proposalStore ?? createProposalStore();
  const recordView = params?.recordView ?? createRecordViewStub();
  const service =
    params?.service ??
    createTransactionsServiceStub({
      createSubmitted: vi.fn(async (input) => ({
        id: input.id ?? REQUEST_ID,
        chainRef: input.chainRef,
        origin: input.origin,
        fromAccountKey: input.fromAccountKey,
        status: input.status,
        submitted: input.submitted,
        createdAt: input.createdAt ?? 1,
        updatedAt: input.createdAt ?? 1,
      })),
    });
  const prepare =
    params?.prepare ??
    createPrepareStub({
      prepareTransactionForExecution: vi.fn(async (id: string) => proposalStore.get(id) ?? null),
    });
  const tracking = params?.tracking ?? createTrackingStub();
  const messenger = params?.messenger ?? new Messenger();
  const submissionService = new TransactionSubmissionStore({
    recordView,
    stateLimit: 50,
  });
  const recordService = new TransactionRecordService({
    proposalStore,
    recordView,
    accountCodecs,
    service,
    submission: submissionService,
    tracking: tracking as never,
  });
  const execution = new TransactionExecutionService({
    proposalStore,
    pipeline: new TransactionExecutionPipeline({
      messenger: messenger.scope({ publish: TRANSACTION_TOPICS }),
      proposalStore,
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
    proposalStore,
    recordView,
    service,
    submissionService,
    prepare,
    tracking,
    messenger,
  };
};

const createApprovedTransactionProposal = (
  proposalStore: ReturnType<typeof createProposalStore>,
  input?: Partial<TransactionProposalMeta>,
) =>
  createTransactionProposal(proposalStore, {
    prepared: { gas: "0x5208" },
    status: "approved",
    ...input,
  });

const createRecordView = (input: {
  id?: string;
  status: TransactionRecordView["status"];
  submitted?: TransactionRecordView["submitted"];
  receipt?: TransactionRecordView["receipt"];
  replacedId?: TransactionRecordView["replacedId"];
  updatedAt?: number;
}): TransactionRecordView => {
  return {
    kind: "record",
    id: input.id ?? REQUEST_ID,
    namespace: "eip155",
    chainRef: DEFAULT_CHAIN_REF,
    origin: REQUEST_CONTEXT.origin,
    from: DEFAULT_FROM,
    status: input.status,
    submitted: input.submitted ?? DEFAULT_SUBMITTED,
    receipt: input.receipt ?? null,
    replacedId: input.replacedId ?? null,
    createdAt: 1,
    updatedAt: input.updatedAt ?? 1,
  };
};

describe("TransactionExecutionService", () => {
  it("enqueues approved proposals for execution", async () => {
    const proposalStore = createProposalStore();
    createTransactionProposal(proposalStore, {
      status: "pending",
    });
    markReviewReady(proposalStore, REQUEST_ID, {
      executionPrepared: { gas: "0x5208" },
      reviewPreparedSnapshot: { gas: "0x5208" },
    });
    const { execution } = createExecutionService({
      proposalStore,
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
    const { execution, proposalStore } = createExecutionService({
      namespaces: createNamespacesStub(() => undefined),
    });
    createApprovedTransactionProposal(proposalStore);

    await execution.executeApprovedTransaction(REQUEST_ID);

    expect(proposalStore.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "failed",
      error: {
        name: "NamespaceTransactionMissingError",
        message: "No namespace transaction registered for namespace eip155",
      },
    });
  });

  it("marks execution-stage user rejection as userRejected before broadcast", async () => {
    const { execution, proposalStore } = createExecutionService();
    createTransactionProposal(proposalStore, {
      prepared: {},
      status: "approved",
    });

    const rejectionError = Object.assign(new Error("User rejected transaction"), { code: 4001 });
    await execution.rejectTransaction(REQUEST_ID, rejectionError);

    expect(proposalStore.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "failed",
      userRejected: true,
      error: {
        name: "Error",
        message: "User rejected transaction",
        code: 4001,
      },
    });
  });

  it("cancels a queued execution before processing starts", async () => {
    const proposalStore = createProposalStore();
    createTransactionProposal(proposalStore, {
      status: "pending",
    });
    markReviewReady(proposalStore, REQUEST_ID, {
      executionPrepared: { gas: "0x5208" },
      reviewPreparedSnapshot: { gas: "0x5208" },
    });
    const { execution } = createExecutionService({
      proposalStore,
    });
    const processSpy = vi.spyOn(execution, "executeApprovedTransaction").mockResolvedValue(undefined);

    const approved = execution.approveTransaction(REQUEST_ID);
    await execution.rejectTransaction(REQUEST_ID, new Error("Transport disconnected."));
    await expect(approved).resolves.toMatchObject({
      status: "approved",
    });
    await Promise.resolve();

    expect(processSpy).not.toHaveBeenCalled();
    expect(proposalStore.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "failed",
      userRejected: false,
      error: {
        message: "Transport disconnected.",
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
    const handleTransition = vi.fn();
    const { execution } = createExecutionService({
      service: createTransactionsServiceStub({
        get: vi.fn(async () =>
          toRecord({
            id: durableMeta.id,
            namespace: durableMeta.namespace,
            chainRef: durableMeta.chainRef,
            origin: durableMeta.origin,
            from: durableMeta.from,
            request: {
              namespace: "eip155",
              chainRef: durableMeta.chainRef,
              payload: { from: durableMeta.from, to: DEFAULT_TO, value: "0x0" },
            },
            prepared: null,
            status: "approved",
            error: null,
            userRejected: false,
            createdAt: durableMeta.createdAt,
            updatedAt: durableMeta.updatedAt,
          }),
        ),
      }),
      recordView: createRecordViewStub({
        commitRecordView,
      }),
      tracking: createTrackingStub({
        stop,
        handleTransition,
      }),
    });

    await execution.rejectTransaction(REQUEST_ID, new Error("Transport disconnected."));

    expect(stop).not.toHaveBeenCalled();
    expect(handleTransition).not.toHaveBeenCalled();
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
    const createSubmitted = vi.fn(async (input) => ({
      id: input.id ?? REQUEST_ID,
      chainRef: input.chainRef,
      origin: input.origin,
      fromAccountKey: input.fromAccountKey,
      status: "broadcast" as const,
      submitted: input.submitted,
      createdAt: input.createdAt ?? 1,
      updatedAt: input.createdAt ?? 1,
    }));
    const handleTransition = vi.fn();
    const recordView = createRecordViewStub();
    const { execution, proposalStore } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: signTransaction as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
      service: createTransactionsServiceStub({
        createSubmitted,
      }),
      recordView,
      tracking: createTrackingStub({
        handleTransition,
      }),
    });

    createApprovedTransactionProposal(proposalStore, {
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
    expect(createSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({
        id: REQUEST_ID,
        status: "broadcast",
        submitted: {
          hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
          chainId: "0xa",
          from: DEFAULT_FROM,
          nonce: "0x7",
        },
      }),
    );
    expect(proposalStore.get(REQUEST_ID)).toBeUndefined();
    expect(recordView.commitRecordView).toHaveBeenCalledTimes(1);
    expect(handleTransition).toHaveBeenCalledTimes(1);
  });

  it("does not create a durable record when broadcast fails", async () => {
    const broadcastError = new Error("RPC unavailable");
    const createSubmitted = vi.fn();
    const { execution, proposalStore } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          broadcast: vi.fn(async () => {
            throw broadcastError;
          }) as never,
        }),
      ),
      service: createTransactionsServiceStub({
        createSubmitted: createSubmitted as never,
      }),
    });
    createApprovedTransactionProposal(proposalStore);

    await execution.executeApprovedTransaction(REQUEST_ID);

    expect(createSubmitted).not.toHaveBeenCalled();
    expect(proposalStore.get(REQUEST_ID)).toMatchObject({
      status: "failed",
      error: {
        message: "RPC unavailable",
      },
    });
  });

  it("does not create a durable record when signing fails", async () => {
    const signError = new Error("Signer failed");
    const createSubmitted = vi.fn();
    const broadcastTransaction = vi.fn();
    const { execution, proposalStore } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: vi.fn(async () => {
            throw signError;
          }) as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
      service: createTransactionsServiceStub({
        createSubmitted: createSubmitted as never,
      }),
    });
    createApprovedTransactionProposal(proposalStore);

    await execution.executeApprovedTransaction(REQUEST_ID);

    expect(broadcastTransaction).not.toHaveBeenCalled();
    expect(createSubmitted).not.toHaveBeenCalled();
    expect(proposalStore.get(REQUEST_ID)).toMatchObject({
      status: "failed",
      error: {
        message: "Signer failed",
      },
    });
  });

  it("records submission persistence failure without keeping the proposal alive after broadcast", async () => {
    const { execution, proposalStore, submissionService } = createExecutionService({
      service: createTransactionsServiceStub({
        createSubmitted: vi.fn(async () => {
          throw new Error("Local transaction store unavailable");
        }),
      }),
    });
    createApprovedTransactionProposal(proposalStore);

    await execution.executeApprovedTransaction(REQUEST_ID);

    expect(proposalStore.get(REQUEST_ID)).toBeUndefined();
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
    let releaseSign: (() => void) | null = null;
    const signStarted = new Promise<void>((resolve) => {
      releaseSign = resolve;
    });
    const signTransaction = vi.fn(async () => {
      await signStarted;
      return { raw: "0x1111" };
    });
    const broadcastTransaction = vi.fn(async () => ({
      submitted: DEFAULT_SUBMITTED,
    }));

    const { execution, proposalStore } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: signTransaction as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
    });
    createApprovedTransactionProposal(proposalStore);

    const processing = execution.executeApprovedTransaction(REQUEST_ID);
    await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(1));

    await execution.rejectTransaction(REQUEST_ID, new Error("User cancelled before submission"));
    releaseSign?.();
    await processing;

    expect(proposalStore.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "failed",
      error: {
        message: "User cancelled before submission",
      },
    });
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it("aborts an in-flight signing attempt when external cancellation arrives", async () => {
    let observedSignal: AbortSignal | null = null;
    let releaseSign: (() => void) | null = null;
    const signBlocked = new Promise<void>((resolve) => {
      releaseSign = resolve;
    });
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

    const { execution, proposalStore } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: signTransaction as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
    });
    createApprovedTransactionProposal(proposalStore);

    const processing = execution.executeApprovedTransaction(REQUEST_ID);
    await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(1));

    await execution.rejectTransaction(REQUEST_ID, new Error("User cancelled before submission"));
    expect(observedSignal?.aborted).toBe(true);

    releaseSign?.();
    await processing;

    expect(proposalStore.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "failed",
      error: {
        message: "User cancelled before submission",
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
    const createSubmitted = vi.fn(async (input) => ({
      id: input.id ?? REQUEST_ID,
      chainRef: input.chainRef,
      origin: input.origin,
      fromAccountKey: input.fromAccountKey,
      status: "broadcast" as const,
      submitted: input.submitted,
      createdAt: input.createdAt ?? 1,
      updatedAt: input.createdAt ?? 1,
    }));
    const recordView = createRecordViewStub();
    const { execution, proposalStore } = createExecutionService({
      messenger,
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: signTransaction as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
      service: createTransactionsServiceStub({
        createSubmitted,
      }),
      recordView,
    });
    createApprovedTransactionProposal(proposalStore);

    messenger.subscribe(TRANSACTION_BROADCAST_STARTED, ({ id }) => {
      void execution.rejectTransaction(id, new Error("User cancelled too late"));
    });

    await execution.executeApprovedTransaction(REQUEST_ID);

    expect(createSubmitted).toHaveBeenCalledTimes(1);
    expect(proposalStore.get(REQUEST_ID)).toBeUndefined();
    expect(recordView.commitRecordView).toHaveBeenCalledTimes(1);
  });

  it("keeps the broadcast result when rejection races after broadcast has started", async () => {
    let releaseBroadcast: (() => void) | null = null;
    const broadcastStarted = new Promise<void>((resolve) => {
      releaseBroadcast = resolve;
    });
    const signTransaction = vi.fn(async () => ({ raw: "0x1111" }));
    const broadcastTransaction = vi.fn(async () => {
      await broadcastStarted;
      return {
        submitted: DEFAULT_SUBMITTED,
      };
    });
    const createSubmitted = vi.fn(async (input) => ({
      id: input.id ?? REQUEST_ID,
      chainRef: input.chainRef,
      origin: input.origin,
      fromAccountKey: input.fromAccountKey,
      status: "broadcast" as const,
      submitted: input.submitted,
      createdAt: input.createdAt ?? 1,
      updatedAt: input.createdAt ?? 1,
    }));

    const recordView = createRecordViewStub();
    const { execution, proposalStore } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: signTransaction as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
      service: createTransactionsServiceStub({
        createSubmitted,
      }),
      recordView,
    });
    createApprovedTransactionProposal(proposalStore);

    const processing = execution.executeApprovedTransaction(REQUEST_ID);
    await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(broadcastTransaction).toHaveBeenCalledTimes(1));

    await execution.rejectTransaction(REQUEST_ID, new Error("User cancelled too late"));
    releaseBroadcast?.();
    await processing;

    expect(createSubmitted).toHaveBeenCalledTimes(1);
    expect(proposalStore.get(REQUEST_ID)).toBeUndefined();
    expect(recordView.commitRecordView).toHaveBeenCalledTimes(1);
  });

  it("keeps the broadcast result when rejection races during durable persistence", async () => {
    let releasePersistence: (() => void) | null = null;
    let persistenceStarted: (() => void) | null = null;
    const persistenceStartedPromise = new Promise<void>((resolve) => {
      persistenceStarted = resolve;
    });
    const persistenceBlocked = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const signTransaction = vi.fn(async () => ({ raw: "0x1111" }));
    const broadcastTransaction = vi.fn(async () => ({
      submitted: DEFAULT_SUBMITTED,
    }));
    const createSubmitted = vi.fn(async (input) => {
      persistenceStarted?.();
      await persistenceBlocked;
      return {
        id: input.id ?? REQUEST_ID,
        chainRef: input.chainRef,
        origin: input.origin,
        fromAccountKey: input.fromAccountKey,
        status: "broadcast" as const,
        submitted: input.submitted,
        createdAt: input.createdAt ?? 1,
        updatedAt: input.createdAt ?? 1,
      };
    });

    const recordView = createRecordViewStub();
    const { execution, proposalStore } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: signTransaction as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
      service: createTransactionsServiceStub({
        createSubmitted,
      }),
      recordView,
    });
    createApprovedTransactionProposal(proposalStore);

    const processing = execution.executeApprovedTransaction(REQUEST_ID);
    await persistenceStartedPromise;

    await execution.rejectTransaction(REQUEST_ID, new Error("User cancelled after submission"));
    releasePersistence?.();
    await processing;

    expect(createSubmitted).toHaveBeenCalledTimes(1);
    expect(proposalStore.get(REQUEST_ID)).toBeUndefined();
    expect(recordView.commitRecordView).toHaveBeenCalledTimes(1);
  });

  it("re-enqueues approved proposals when resuming approved proposals", async () => {
    const { execution, proposalStore } = createExecutionService();
    createApprovedTransactionProposal(proposalStore);
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
    const { execution, proposalStore } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: vi.fn(async () => {
            throw lockError;
          }) as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
    });
    createApprovedTransactionProposal(proposalStore);

    await execution.executeApprovedTransaction(REQUEST_ID);

    expect(proposalStore.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "failed",
      userRejected: false,
      error: {
        name: "ArxError",
        message: "Wallet is locked.",
      },
    });
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it("fails approved transactions that are missing prepared params", async () => {
    const proposalStore = createProposalStore();
    createTransactionProposal(proposalStore, {
      status: "pending",
    });
    const state = proposalStore.peek(REQUEST_ID);
    if (!state) {
      throw new Error("Proposal not found");
    }
    state.phase = "approved";
    state.prepared = null;
    const signTransaction = vi.fn(async () => ({ raw: "0x1111" }));
    const { execution } = createExecutionService({
      proposalStore,
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: signTransaction as never,
        }),
      ),
    });

    await execution.executeApprovedTransaction(REQUEST_ID);

    expect(signTransaction).not.toHaveBeenCalled();
    expect(proposalStore.get(REQUEST_ID)).toMatchObject({
      status: "failed",
      error: {
        message: "Approved transaction is missing prepared execution parameters.",
      },
    });
  });
});
