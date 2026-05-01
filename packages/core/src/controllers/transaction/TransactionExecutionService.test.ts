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
  DEFAULT_LOCATOR,
  DEFAULT_SUBMITTED,
  DEFAULT_TO,
  REQUEST_CONTEXT,
  REQUEST_ID,
  toRecord,
} from "./__fixtures__/transactionServices.js";
import { TransactionExecutionService } from "./TransactionExecutionService.js";
import { TRANSACTION_BROADCAST_STARTED, TRANSACTION_TOPICS } from "./topics.js";
import type { TransactionApproveResult, TransactionMeta, TransactionRecordView } from "./types.js";

const createProposalServiceStub = (params?: { approveForExecution?: (id: string) => TransactionApproveResult }) =>
  ({
    approveForExecution:
      params?.approveForExecution ??
      vi.fn(() => ({
        status: "approved",
        transaction: {
          id: REQUEST_ID,
          status: "approved",
        },
      })),
  }) as never;

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
  proposals?: ReturnType<typeof createProposalServiceStub>;
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
        locator: input.locator,
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
  const execution = new TransactionExecutionService({
    messenger: messenger.scope({ publish: TRANSACTION_TOPICS }),
    proposalStore,
    recordView,
    accountCodecs,
    namespaces: (params?.namespaces ?? createNamespacesStub()) as never,
    service,
    prepare: prepare as never,
    proposals: params?.proposals ?? createProposalServiceStub(),
    tracking,
    readTransactionTimestamp: () => 1,
  });

  return {
    execution,
    proposalStore,
    recordView,
    service,
    prepare,
    tracking,
    messenger,
  };
};

const createApprovedTransactionProposal = (
  proposalStore: ReturnType<typeof createProposalStore>,
  input?: Partial<TransactionMeta>,
) =>
  createTransactionProposal(proposalStore, {
    prepared: { gas: "0x5208" },
    status: "approved",
    ...input,
  });

const createRecordViewFromMeta = (meta: TransactionMeta): TransactionRecordView => {
  if (
    meta.status !== "broadcast" &&
    meta.status !== "confirmed" &&
    meta.status !== "failed" &&
    meta.status !== "replaced"
  ) {
    throw new Error(`Expected durable record status, received ${meta.status}`);
  }
  if (!meta.submitted || !meta.locator) {
    throw new Error("Expected submitted durable meta");
  }

  return {
    kind: "record",
    id: meta.id,
    namespace: meta.namespace,
    chainRef: meta.chainRef,
    origin: meta.origin,
    from: meta.from,
    status: meta.status,
    submitted: meta.submitted,
    locator: meta.locator,
    receipt: meta.receipt,
    replacedId: meta.replacedId,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
};

describe("TransactionExecutionService", () => {
  it("enqueues approved proposals for execution", async () => {
    const proposalStore = createProposalStore();
    createApprovedTransactionProposal(proposalStore);
    const approveForExecution = vi.fn(() => ({
      status: "approved" as const,
      transaction: proposalStore.get(REQUEST_ID) as TransactionMeta,
    }));
    const { execution } = createExecutionService({
      proposalStore,
      proposals: createProposalServiceStub({ approveForExecution }),
    });
    const processTransaction = vi.fn(async () => {});
    const processSpy = vi.spyOn(execution, "processTransaction").mockImplementation(processTransaction);

    await expect(execution.approveTransaction(REQUEST_ID)).resolves.toMatchObject({
      status: "approved",
    });
    await Promise.resolve();

    expect(approveForExecution).toHaveBeenCalledWith(REQUEST_ID);
    expect(processSpy).toHaveBeenCalledWith(REQUEST_ID);
    processSpy.mockRestore();
  });

  it("does not enqueue failed proposal approvals", async () => {
    const approveForExecution = vi.fn(() => ({
      status: "failed" as const,
      reason: "prepare_not_ready" as const,
      message: "Transaction preparation is not ready yet.",
      data: { transactionId: REQUEST_ID },
    }));
    const { execution } = createExecutionService({
      proposals: createProposalServiceStub({ approveForExecution }),
    });
    const processSpy = vi.spyOn(execution, "processTransaction").mockResolvedValue(undefined);

    await expect(execution.approveTransaction(REQUEST_ID)).resolves.toMatchObject({
      status: "failed",
      reason: "prepare_not_ready",
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

    await execution.processTransaction(REQUEST_ID);

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
    createApprovedTransactionProposal(proposalStore);
    const approveForExecution = vi.fn(() => ({
      status: "approved" as const,
      transaction: proposalStore.get(REQUEST_ID) as TransactionMeta,
    }));
    const { execution } = createExecutionService({
      proposalStore,
      proposals: createProposalServiceStub({ approveForExecution }),
    });
    const processSpy = vi.spyOn(execution, "processTransaction").mockResolvedValue(undefined);

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
    const durableMeta: TransactionMeta = {
      id: REQUEST_ID,
      namespace: "eip155",
      chainRef: DEFAULT_CHAIN_REF,
      origin: REQUEST_CONTEXT.origin,
      from: DEFAULT_FROM,
      request: null,
      prepared: null,
      status: "broadcast",
      submitted: {
        hash: "0x1234",
        chainId: "0xa",
        from: DEFAULT_FROM,
        nonce: "0x7",
      },
      locator: { format: "eip155.tx_hash", value: "0x1234" },
      receipt: null,
      replacedId: null,
      error: null,
      userRejected: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const commitRecordView = vi.fn((record: TransactionRecord) => {
      return {
        next: createRecordViewFromMeta({
          ...durableMeta,
          locator: record.locator,
          updatedAt: record.updatedAt,
        }),
      };
    });
    const stop = vi.fn();
    const handleTransition = vi.fn();
    const { execution } = createExecutionService({
      service: createTransactionsServiceStub({
        get: vi.fn(async () => toRecord(durableMeta)),
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
      locator: {
        format: "eip155.tx_hash" as const,
        value: "0x2222222222222222222222222222222222222222222222222222222222222222",
      },
    }));
    const createSubmitted = vi.fn(async (input) => ({
      id: input.id ?? REQUEST_ID,
      chainRef: input.chainRef,
      origin: input.origin,
      fromAccountKey: input.fromAccountKey,
      status: "broadcast" as const,
      submitted: input.submitted,
      locator: input.locator,
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
      proposals: createProposalServiceStub(),
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

    await execution.processTransaction(REQUEST_ID);

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
        locator: {
          format: "eip155.tx_hash",
          value: "0x2222222222222222222222222222222222222222222222222222222222222222",
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

    await execution.processTransaction(REQUEST_ID);

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

    await execution.processTransaction(REQUEST_ID);

    expect(broadcastTransaction).not.toHaveBeenCalled();
    expect(createSubmitted).not.toHaveBeenCalled();
    expect(proposalStore.get(REQUEST_ID)).toMatchObject({
      status: "failed",
      error: {
        message: "Signer failed",
      },
    });
  });

  it("keeps a failed proposal when durable persistence fails after broadcast", async () => {
    const { execution, proposalStore } = createExecutionService({
      service: createTransactionsServiceStub({
        createSubmitted: vi.fn(async () => {
          throw new Error("Local transaction store unavailable");
        }),
      }),
    });
    createApprovedTransactionProposal(proposalStore);

    await execution.processTransaction(REQUEST_ID);

    expect(proposalStore.get(REQUEST_ID)).toMatchObject({
      status: "failed",
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
          locator: DEFAULT_LOCATOR,
        },
      },
    });
    expect(proposalStore.get(REQUEST_ID)).not.toHaveProperty("submitted");
    expect(proposalStore.get(REQUEST_ID)).not.toHaveProperty("locator");
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
      locator: DEFAULT_LOCATOR,
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

    const processing = execution.processTransaction(REQUEST_ID);
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
      locator: DEFAULT_LOCATOR,
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

    const processing = execution.processTransaction(REQUEST_ID);
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
      locator: DEFAULT_LOCATOR,
    }));
    const createSubmitted = vi.fn(async (input) => ({
      id: input.id ?? REQUEST_ID,
      chainRef: input.chainRef,
      origin: input.origin,
      fromAccountKey: input.fromAccountKey,
      status: "broadcast" as const,
      submitted: input.submitted,
      locator: input.locator,
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

    await execution.processTransaction(REQUEST_ID);

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
        locator: DEFAULT_LOCATOR,
      };
    });
    const createSubmitted = vi.fn(async (input) => ({
      id: input.id ?? REQUEST_ID,
      chainRef: input.chainRef,
      origin: input.origin,
      fromAccountKey: input.fromAccountKey,
      status: "broadcast" as const,
      submitted: input.submitted,
      locator: input.locator,
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

    const processing = execution.processTransaction(REQUEST_ID);
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
      locator: DEFAULT_LOCATOR,
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
        locator: input.locator,
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

    const processing = execution.processTransaction(REQUEST_ID);
    await persistenceStartedPromise;

    await execution.rejectTransaction(REQUEST_ID, new Error("User cancelled after submission"));
    releasePersistence?.();
    await processing;

    expect(createSubmitted).toHaveBeenCalledTimes(1);
    expect(proposalStore.get(REQUEST_ID)).toBeUndefined();
    expect(recordView.commitRecordView).toHaveBeenCalledTimes(1);
  });

  it("re-enqueues approved proposals when resuming pending work", async () => {
    const broadcastMeta: TransactionMeta = {
      id: "durable-tx",
      namespace: "eip155",
      chainRef: DEFAULT_CHAIN_REF,
      origin: REQUEST_CONTEXT.origin,
      from: DEFAULT_FROM,
      request: null,
      prepared: null,
      status: "broadcast",
      submitted: DEFAULT_SUBMITTED,
      locator: DEFAULT_LOCATOR,
      receipt: null,
      replacedId: null,
      error: null,
      userRejected: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const processTransaction = vi.fn(async () => {});
    const commitRecordView = vi.fn((record: TransactionRecord) => ({
      next: {
        kind: "record",
        id: record.id,
        namespace: "eip155",
        chainRef: record.chainRef,
        origin: record.origin,
        from: DEFAULT_FROM,
        status: record.status,
        submitted: record.submitted,
        locator: record.locator,
        receipt: record.receipt ?? null,
        replacedId: record.replacedId ?? null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      } satisfies TransactionRecordView,
    }));
    const resumeBroadcast = vi.fn();
    const list = vi
      .fn<(params?: unknown) => Promise<TransactionRecord[]>>()
      .mockResolvedValueOnce([toRecord(broadcastMeta)])
      .mockResolvedValueOnce([]);
    const recordView = createRecordViewStub({
      commitRecordView,
    });
    const { execution, proposalStore } = createExecutionService({
      service: createTransactionsServiceStub({
        list: list as never,
      }),
      tracking: createTrackingStub({
        handleTransition: vi.fn(),
        resumeBroadcast,
      }),
      recordView,
    });

    createApprovedTransactionProposal(proposalStore);
    const processSpy = vi.spyOn(execution, "processTransaction").mockImplementation(processTransaction);

    await execution.resumePending();
    await Promise.resolve();

    expect(processSpy).toHaveBeenCalledWith(REQUEST_ID);
    processSpy.mockRestore();
    expect(list).toHaveBeenCalledTimes(2);
    expect(commitRecordView).toHaveBeenCalledWith(toRecord(broadcastMeta));
    expect(resumeBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "durable-tx",
        status: "broadcast",
      }),
    );
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

    await execution.processTransaction(REQUEST_ID);

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

  it("prepares for execution when an approved transaction is missing prepared params", async () => {
    const proposalStore = createProposalStore();
    createTransactionProposal(proposalStore, {
      prepared: null,
      status: "approved",
    });
    const prepareTransactionForExecution = vi.fn(async () => {
      proposalStore.patch(REQUEST_ID, { prepared: { gas: "0x5208" } });
      return proposalStore.get(REQUEST_ID) ?? null;
    });
    const signTransaction = vi.fn(async () => ({ raw: "0x1111" }));
    const { execution } = createExecutionService({
      proposalStore,
      prepare: createPrepareStub({
        prepareTransactionForExecution,
      }),
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: signTransaction as never,
        }),
      ),
    });

    await execution.processTransaction(REQUEST_ID);

    expect(prepareTransactionForExecution).toHaveBeenCalledWith(REQUEST_ID);
    expect(signTransaction).toHaveBeenCalledWith(expect.anything(), { gas: "0x5208" }, { signal: expect.anything() });
  });
});
