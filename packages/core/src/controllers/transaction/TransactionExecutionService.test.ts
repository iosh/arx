import { ArxReasons, arxError } from "@arx/errors";
import { describe, expect, it, vi } from "vitest";
import type { TransactionRecord } from "../../storage/records.js";
import {
  accountCodecs,
  createDefaultAccountKey,
  createNamespacesStub,
  createNamespaceTransactionStub,
  createPrepareStub,
  createRuntime,
  createRuntimeTransaction,
  createTransactionsServiceStub,
  createViewStub,
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
import type { TransactionApproveResult, TransactionMeta } from "./types.js";

const createProposalServiceStub = (params?: {
  approveForExecution?: (id: string) => TransactionApproveResult;
  deleteReviewSession?: (transactionId: string) => boolean;
}) =>
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
    deleteReviewSession: params?.deleteReviewSession ?? vi.fn(() => false),
  }) as never;

const createTrackingStub = (params?: {
  stop?: (id: string) => void;
  handleTransition?: (previous: TransactionMeta | undefined, next: TransactionMeta) => void;
  resumeBroadcast?: (meta: TransactionMeta) => void;
}) =>
  ({
    stop: params?.stop ?? vi.fn(),
    handleTransition: params?.handleTransition ?? vi.fn(),
    resumeBroadcast: params?.resumeBroadcast ?? vi.fn(),
  }) as never;

const createExecutionService = (params?: {
  runtime?: ReturnType<typeof createRuntime>;
  namespaces?: ReturnType<typeof createNamespacesStub>;
  service?: ReturnType<typeof createTransactionsServiceStub>;
  prepare?: ReturnType<typeof createPrepareStub>;
  view?: ReturnType<typeof createViewStub>;
  proposals?: ReturnType<typeof createProposalServiceStub>;
  tracking?: ReturnType<typeof createTrackingStub>;
}) => {
  const runtime = params?.runtime ?? createRuntime();
  const view = params?.view ?? createViewStub();
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
      prepareTransactionForExecution: vi.fn(async (id: string) => runtime.get(id) ?? null),
    });
  const tracking = params?.tracking ?? createTrackingStub();
  const execution = new TransactionExecutionService({
    runtime,
    view,
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
    runtime,
    view,
    service,
    prepare,
    tracking,
  };
};

const createApprovedRuntimeTransaction = (
  runtime: ReturnType<typeof createRuntime>,
  input?: Partial<TransactionMeta>,
) =>
  createRuntimeTransaction(runtime, {
    prepared: { gas: "0x5208" },
    status: "approved",
    ...input,
  });

describe("TransactionExecutionService", () => {
  it("enqueues approved proposals for execution", async () => {
    const runtime = createRuntime();
    createApprovedRuntimeTransaction(runtime);
    const approveForExecution = vi.fn(() => ({
      status: "approved" as const,
      transaction: runtime.get(REQUEST_ID) as TransactionMeta,
    }));
    const { execution } = createExecutionService({
      runtime,
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
    const { execution, runtime } = createExecutionService({
      namespaces: createNamespacesStub(() => undefined),
    });
    createApprovedRuntimeTransaction(runtime);

    await execution.processTransaction(REQUEST_ID);

    expect(runtime.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "failed",
      error: {
        name: "NamespaceTransactionMissingError",
        message: "No namespace transaction registered for namespace eip155",
      },
    });
  });

  it("marks signer-stage user rejection as userRejected before broadcast", async () => {
    const { execution, runtime } = createExecutionService();
    createRuntimeTransaction(runtime, {
      prepared: {},
      status: "signed",
    });

    const rejectionError = Object.assign(new Error("User rejected transaction"), { code: 4001 });
    await execution.rejectTransaction(REQUEST_ID, rejectionError);

    expect(runtime.get(REQUEST_ID)).toMatchObject({
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

  it("marks durable broadcast transactions as failed when rejection happens after submission", async () => {
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
    const failedMeta: TransactionMeta = {
      ...durableMeta,
      status: "failed",
      updatedAt: 2,
    };
    const transition = vi.fn(async () => toRecord(failedMeta));
    const commitRecord = vi.fn((record: TransactionRecord) => {
      if (record.status === "broadcast") {
        return {
          next: durableMeta,
        };
      }

      const next = {
        ...failedMeta,
        locator: record.locator,
        updatedAt: record.updatedAt,
      };
      return {
        previous: durableMeta,
        next,
      };
    });
    const stop = vi.fn();
    const handleTransition = vi.fn();
    const { execution } = createExecutionService({
      service: createTransactionsServiceStub({
        get: vi.fn(async () => toRecord(durableMeta)),
        transition,
      }),
      view: createViewStub({
        commitRecord,
      }),
      tracking: createTrackingStub({
        stop,
        handleTransition,
      }),
    });

    await execution.rejectTransaction(REQUEST_ID, new Error("Transport disconnected."));

    expect(transition).toHaveBeenCalledWith({
      id: REQUEST_ID,
      fromStatus: "broadcast",
      toStatus: "failed",
    });
    expect(stop).toHaveBeenCalledWith(REQUEST_ID);
    expect(handleTransition).toHaveBeenCalledWith(durableMeta, failedMeta);
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
    const deleteReviewSession = vi.fn(() => true);
    const view = createViewStub();
    const { execution, runtime } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: signTransaction as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
      service: createTransactionsServiceStub({
        createSubmitted,
      }),
      view,
      tracking: createTrackingStub({
        handleTransition,
      }),
      proposals: createProposalServiceStub({
        deleteReviewSession,
      }),
    });

    createApprovedRuntimeTransaction(runtime, {
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
    expect(runtime.get(REQUEST_ID)).toBeUndefined();
    expect(deleteReviewSession).toHaveBeenCalledWith(REQUEST_ID);
    expect(view.commitRecord).toHaveBeenCalledTimes(1);
    expect(handleTransition).toHaveBeenCalledTimes(1);
  });

  it("does not create a durable record when broadcast fails", async () => {
    const broadcastError = new Error("RPC unavailable");
    const createSubmitted = vi.fn();
    const { execution, runtime } = createExecutionService({
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
    createApprovedRuntimeTransaction(runtime);

    await execution.processTransaction(REQUEST_ID);

    expect(createSubmitted).not.toHaveBeenCalled();
    expect(runtime.get(REQUEST_ID)).toMatchObject({
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
    const { execution, runtime } = createExecutionService({
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
    createApprovedRuntimeTransaction(runtime);

    await execution.processTransaction(REQUEST_ID);

    expect(broadcastTransaction).not.toHaveBeenCalled();
    expect(createSubmitted).not.toHaveBeenCalled();
    expect(runtime.get(REQUEST_ID)).toMatchObject({
      status: "failed",
      error: {
        message: "Signer failed",
      },
    });
  });

  it("keeps a failed runtime proposal when durable persistence fails after broadcast", async () => {
    const { execution, runtime } = createExecutionService({
      service: createTransactionsServiceStub({
        createSubmitted: vi.fn(async () => {
          throw new Error("Local transaction store unavailable");
        }),
      }),
    });
    createApprovedRuntimeTransaction(runtime);

    await execution.processTransaction(REQUEST_ID);

    expect(runtime.get(REQUEST_ID)).toMatchObject({
      status: "failed",
      submitted: DEFAULT_SUBMITTED,
      locator: DEFAULT_LOCATOR,
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
  });

  it("does not revive a rejected runtime transaction after async signing resolves", async () => {
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

    const { execution, runtime } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: signTransaction as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
    });
    createApprovedRuntimeTransaction(runtime);

    const processing = execution.processTransaction(REQUEST_ID);
    await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(1));

    await execution.rejectTransaction(REQUEST_ID, new Error("User cancelled before submission"));
    releaseSign?.();
    await processing;

    expect(runtime.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "failed",
      error: {
        message: "User cancelled before submission",
      },
    });
    expect(broadcastTransaction).not.toHaveBeenCalled();
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

    const view = createViewStub();
    const { execution, runtime } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: signTransaction as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
      service: createTransactionsServiceStub({
        createSubmitted,
      }),
      view,
    });
    createApprovedRuntimeTransaction(runtime);

    const processing = execution.processTransaction(REQUEST_ID);
    await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(broadcastTransaction).toHaveBeenCalledTimes(1));

    await execution.rejectTransaction(REQUEST_ID, new Error("User cancelled too late"));
    releaseBroadcast?.();
    await processing;

    expect(createSubmitted).toHaveBeenCalledTimes(1);
    expect(runtime.get(REQUEST_ID)).toBeUndefined();
    expect(view.commitRecord).toHaveBeenCalledTimes(1);
  });

  it("re-enqueues approved runtime transactions when resuming pending work", async () => {
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
    const commitRecord = vi.fn((record: TransactionRecord) => ({
      next: {
        id: record.id,
        namespace: "eip155",
        chainRef: record.chainRef,
        origin: record.origin,
        from: DEFAULT_FROM,
        request: null,
        prepared: null,
        status: record.status,
        submitted: record.submitted,
        locator: record.locator,
        receipt: record.receipt ?? null,
        replacedId: record.replacedId ?? null,
        error: null,
        userRejected: false,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      } satisfies TransactionMeta,
    }));
    const resumeBroadcast = vi.fn();
    const list = vi
      .fn<(params?: unknown) => Promise<TransactionRecord[]>>()
      .mockResolvedValueOnce([toRecord(broadcastMeta)])
      .mockResolvedValueOnce([]);
    const view = createViewStub({
      commitRecord,
    });
    const { execution, runtime } = createExecutionService({
      service: createTransactionsServiceStub({
        list: list as never,
      }),
      tracking: createTrackingStub({
        handleTransition: vi.fn(),
        resumeBroadcast,
      }),
      view,
    });

    createApprovedRuntimeTransaction(runtime);
    createRuntimeTransaction(runtime, {
      id: "signed-tx",
      fromAccountKey: createDefaultAccountKey(),
      request: {
        namespace: "eip155",
        chainRef: DEFAULT_CHAIN_REF,
        payload: { from: DEFAULT_FROM, to: "0xcccccccccccccccccccccccccccccccccccccccc", value: "0x0" },
      },
      prepared: { gas: "0x5208" },
      status: "signed",
    });

    const processSpy = vi.spyOn(execution, "processTransaction").mockImplementation(processTransaction);

    await execution.resumePending();
    await Promise.resolve();

    expect(processSpy).toHaveBeenCalledWith(REQUEST_ID);
    expect(processSpy).not.toHaveBeenCalledWith("signed-tx");
    processSpy.mockRestore();
    expect(list).toHaveBeenCalledTimes(2);
    expect(commitRecord).toHaveBeenCalledWith(toRecord(broadcastMeta));
    expect(resumeBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "durable-tx",
        status: "broadcast",
      }),
    );
  });

  it("fails runtime transactions when signing is interrupted by lock", async () => {
    const lockError = arxError({
      reason: ArxReasons.SessionLocked,
      message: "Wallet is locked.",
    });
    const broadcastTransaction = vi.fn();
    const { execution, runtime } = createExecutionService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: vi.fn(async () => {
            throw lockError;
          }) as never,
          broadcast: broadcastTransaction as never,
        }),
      ),
    });
    createApprovedRuntimeTransaction(runtime);

    await execution.processTransaction(REQUEST_ID);

    expect(runtime.get(REQUEST_ID)).toMatchObject({
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
    const runtime = createRuntime();
    createRuntimeTransaction(runtime, {
      prepared: null,
      status: "approved",
    });
    const prepareTransactionForExecution = vi.fn(async () => {
      runtime.patch(REQUEST_ID, { prepared: { gas: "0x5208" } });
      return runtime.get(REQUEST_ID) ?? null;
    });
    const signTransaction = vi.fn(async () => ({ raw: "0x1111" }));
    const { execution } = createExecutionService({
      runtime,
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
    expect(signTransaction).toHaveBeenCalledWith(expect.anything(), { gas: "0x5208" });
  });
});
