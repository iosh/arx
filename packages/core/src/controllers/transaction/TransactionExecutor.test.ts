import { ArxReasons, arxError } from "@arx/errors";
import { describe, expect, it, vi } from "vitest";
import { toAccountKeyFromAddress } from "../../accounts/addressing/accountKey.js";
import { createAccountCodecRegistry, eip155Codec } from "../../accounts/addressing/codec.js";
import { TransactionReviewSessions } from "../../controllers/transaction/review/session.js";
import { TransactionPrepareManager } from "../../controllers/transaction/TransactionPrepareManager.js";
import { Messenger } from "../../messenger/Messenger.js";
import type { TransactionRecord } from "../../storage/records.js";
import { RuntimeTransactionStore } from "./RuntimeTransactionStore.js";
import { TransactionExecutor } from "./TransactionExecutor.js";
import { TRANSACTION_TOPICS } from "./topics.js";
import type { TransactionMeta } from "./types.js";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const APPROVAL_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_CONTEXT = {
  transport: "provider" as const,
  origin: "https://dapp.example",
  portId: "port-1",
  sessionId: "session-1",
  requestId: "request-1",
};
const accountCodecs = createAccountCodecRegistry([eip155Codec]);

const createReceiptTrackingStub = () => ({
  fetchReceipt: vi.fn(async () => null),
});

const DEFAULT_LOCATOR = { format: "eip155.tx_hash" as const, value: "0xdeadbeef" };
const DEFAULT_SUBMITTED = {
  hash: DEFAULT_LOCATOR.value,
  chainId: "0xa",
  from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  nonce: "0x7",
};

const createRuntime = () =>
  new RuntimeTransactionStore({
    messenger: new Messenger().scope({ publish: TRANSACTION_TOPICS }),
    accountCodecs,
  });

const toRecord = (meta: TransactionMeta): TransactionRecord => ({
  id: meta.id,
  chainRef: meta.chainRef,
  origin: meta.origin,
  fromAccountKey: toAccountKeyFromAddress({
    chainRef: meta.chainRef,
    address: meta.from ?? (meta.request?.payload as { from?: string } | undefined)?.from ?? "",
    accountCodecs,
  }),
  status:
    meta.status === "broadcast" || meta.status === "confirmed" || meta.status === "failed" || meta.status === "replaced"
      ? meta.status
      : "failed",
  submitted: meta.submitted ?? DEFAULT_SUBMITTED,
  locator: meta.locator ?? DEFAULT_LOCATOR,
  ...(meta.receipt !== null ? { receipt: meta.receipt } : {}),
  ...(meta.replacedId !== null ? { replacedId: meta.replacedId } : {}),
  createdAt: meta.createdAt,
  updatedAt: meta.updatedAt,
});

const createExecutor = (params?: {
  chainRef?: string;
  from?: string;
  runtime?: RuntimeTransactionStore;
  namespaces?: {
    get: () => unknown;
  };
  approvals?: {
    create: (...args: unknown[]) => unknown;
  };
  service?: Partial<{
    get: (id: string) => Promise<TransactionRecord | null>;
    list: (params?: unknown) => Promise<TransactionRecord[]>;
    createSubmitted: (input: unknown) => Promise<TransactionRecord>;
    transition: (input: unknown) => Promise<TransactionRecord | null>;
    subscribeChanged: (handler: (payload: unknown) => void) => () => void;
    remove: (id: string) => Promise<void>;
  }>;
  prepare?: Partial<{
    queuePrepare: (id: string) => void;
    ensurePrepared: (id: string, opts?: unknown) => Promise<TransactionMeta | null>;
  }>;
  tracking?: Partial<{
    stop: (id: string) => void;
    handleTransition: (previous: TransactionMeta | undefined, next: TransactionMeta) => void;
    resumeBroadcast: (meta: TransactionMeta) => void;
  }>;
  view?: Partial<{
    commitRecord: (record: TransactionRecord) => { previous?: TransactionMeta; next: TransactionMeta };
    requestSync: () => void;
  }>;
}) => {
  const chainRef = params?.chainRef ?? "eip155:10";
  const from = params?.from ?? "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const accountKey = toAccountKeyFromAddress({ chainRef, address: from, accountCodecs });
  const runtime = params?.runtime ?? createRuntime();
  const queuePrepare = vi.fn();
  const createSubmitted = vi.fn(
    async (input: {
      id: string;
      chainRef: string;
      origin: string;
      fromAccountKey: string;
      status: "broadcast";
      submitted: NonNullable<TransactionMeta["submitted"]>;
      locator: NonNullable<TransactionMeta["locator"]>;
      createdAt: number;
    }) => {
      return {
        id: input.id,
        chainRef: input.chainRef,
        origin: input.origin,
        fromAccountKey: input.fromAccountKey,
        status: input.status,
        submitted: input.submitted,
        locator: input.locator,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      } satisfies TransactionRecord;
    },
  );
  const commitRecord = vi.fn((record: TransactionRecord) => ({
    next: {
      id: record.id,
      namespace: record.chainRef.split(":", 1)[0] ?? "",
      chainRef: record.chainRef,
      origin: record.origin,
      from,
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
  const requestSync = vi.fn();
  const transition = vi.fn(async () => null);
  const stop = vi.fn();
  const handleTransition = vi.fn();
  const resumeBroadcast = vi.fn();

  const executor = new TransactionExecutor({
    runtime,
    view: {
      commitRecord: params?.view?.commitRecord ?? commitRecord,
      requestSync: params?.view?.requestSync ?? requestSync,
    } as never,
    accountCodecs,
    networkSelection: {
      getSelectedChainRef: (namespace: string) => (namespace === "eip155" ? chainRef : null),
    } as never,
    supportedChains: {
      getChain: () => null,
    } as never,
    accounts: {
      getActiveAccountForNamespace: () => ({
        accountKey,
        namespace: "eip155",
        canonicalAddress: from,
        displayAddress: from,
      }),
      listOwnedForNamespace: () => [
        {
          accountKey,
          namespace: "eip155",
          canonicalAddress: from,
          displayAddress: from,
        },
      ],
    } as never,
    approvals: {
      create:
        params?.approvals?.create ??
        vi.fn(() => ({
          approvalId: APPROVAL_ID,
          settled: Promise.resolve(undefined),
        })),
    } as never,
    namespaces: (params?.namespaces ??
      ({
        get: () => ({
          validateRequest: () => undefined,
          receiptTracking: createReceiptTrackingStub(),
        }),
      } as const)) as never,
    service: {
      get: params?.service?.get ?? vi.fn(async () => null),
      list: params?.service?.list ?? vi.fn(async () => []),
      createSubmitted: params?.service?.createSubmitted ?? createSubmitted,
      transition: params?.service?.transition ?? transition,
      subscribeChanged: params?.service?.subscribeChanged ?? vi.fn(() => () => {}),
      remove: params?.service?.remove ?? vi.fn(async () => {}),
    } as never,
    prepare: {
      queuePrepare: params?.prepare?.queuePrepare ?? queuePrepare,
      ensurePrepared:
        params?.prepare?.ensurePrepared ??
        vi.fn(async (id: string) => {
          return runtime.get(id);
        }),
    } as never,
    reviewSessions: {} as never,
    tracking: {
      stop: params?.tracking?.stop ?? stop,
      handleTransition: params?.tracking?.handleTransition ?? handleTransition,
      resumeBroadcast: params?.tracking?.resumeBroadcast ?? resumeBroadcast,
    } as never,
    now: () => 1,
  });

  return {
    executor,
    runtime,
    queuePrepare,
    createSubmitted,
    commitRecord,
    requestSync,
    transition,
    stop,
    handleTransition,
    resumeBroadcast,
    chainRef,
    from,
    accountKey,
  };
};

describe("TransactionExecutor", () => {
  it("begins a transaction approval with a linked but distinct approval id", async () => {
    let settleApproval: (() => void) | null = null;
    const createApproval = vi.fn(() => ({
      approvalId: APPROVAL_ID,
      settled: new Promise<void>((resolve) => {
        settleApproval = resolve;
      }),
    }));
    const { executor, runtime, queuePrepare, chainRef } = createExecutor({
      approvals: {
        create: createApproval,
      },
    });

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(APPROVAL_ID);

    const handoff = await executor.beginTransactionApproval(
      {
        namespace: "eip155",
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      },
      REQUEST_CONTEXT,
    );

    randomUuidSpy.mockRestore();

    expect(handoff).toMatchObject({
      transactionId: REQUEST_ID,
      approvalId: APPROVAL_ID,
      pendingMeta: {
        id: REQUEST_ID,
        status: "pending",
        chainRef,
        namespace: "eip155",
      },
    });
    expect(runtime.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "pending",
      chainRef,
    });
    expect(queuePrepare).toHaveBeenCalledWith(REQUEST_ID);
    expect(createApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: APPROVAL_ID,
        createdAt: 1,
        origin: REQUEST_CONTEXT.origin,
        subject: {
          kind: "transaction",
          transactionId: REQUEST_ID,
        },
        request: expect.objectContaining({
          chainRef,
        }),
      }),
      expect.objectContaining({
        origin: REQUEST_CONTEXT.origin,
        requestId: REQUEST_CONTEXT.requestId,
      }),
    );

    settleApproval?.();
    await expect(handoff.waitForApprovalDecision()).resolves.toMatchObject({
      id: REQUEST_ID,
      status: "pending",
    });
  });

  it("attaches provider-scoped transaction approvals through the provider request handle", async () => {
    const createApproval = vi.fn(() => ({
      approvalId: APPROVAL_ID,
      settled: Promise.resolve(undefined),
    }));
    const attachBlockingApproval = vi.fn(
      <T>(
        createLinkedApproval: (reservation: { approvalId: string; createdAt: number }) => T,
        reservation?: Partial<{ approvalId: string; createdAt: number }>,
      ) =>
        createLinkedApproval({
          approvalId: reservation?.approvalId ?? "unexpected-approval-id",
          createdAt: reservation?.createdAt ?? 0,
        }),
    );
    const { executor } = createExecutor({
      approvals: {
        create: createApproval,
      },
    });

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(APPROVAL_ID);

    const handoff = await executor.beginTransactionApproval(
      {
        namespace: "eip155",
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      },
      REQUEST_CONTEXT,
      {
        providerRequestHandle: {
          id: REQUEST_CONTEXT.requestId,
          providerNamespace: "eip155",
          attachBlockingApproval,
          fulfill: () => true,
          reject: () => true,
          cancel: async () => true,
          getTerminalError: () => null,
        },
      },
    );

    randomUuidSpy.mockRestore();

    expect(handoff.approvalId).toBe(APPROVAL_ID);
    expect(attachBlockingApproval).toHaveBeenCalledWith(expect.any(Function), {
      approvalId: APPROVAL_ID,
      createdAt: 1,
    });
    expect(createApproval).toHaveBeenCalledTimes(1);
  });

  it("fails the runtime transaction if provider scope is lost before approval attach completes", async () => {
    const attachFailure = arxError({
      reason: ArxReasons.TransportDisconnected,
      message: "Transport disconnected.",
    });
    const queuePrepare = vi.fn();
    const { executor, runtime } = createExecutor({
      prepare: {
        queuePrepare,
      },
    });

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(APPROVAL_ID);

    await expect(
      executor.beginTransactionApproval(
        {
          namespace: "eip155",
          payload: {
            from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
            data: "0x",
          },
        },
        REQUEST_CONTEXT,
        {
          providerRequestHandle: {
            id: REQUEST_CONTEXT.requestId,
            providerNamespace: "eip155",
            attachBlockingApproval: () => {
              throw attachFailure;
            },
            fulfill: () => true,
            reject: () => true,
            cancel: async () => true,
            getTerminalError: () => attachFailure,
          },
        },
      ),
    ).rejects.toBe(attachFailure);

    randomUuidSpy.mockRestore();

    expect(queuePrepare).not.toHaveBeenCalled();
    expect(runtime.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "failed",
      error: {
        message: "Transport disconnected.",
      },
      userRejected: false,
    });
  });

  it("uses namespace-specific active chain when request.chainRef is absent", async () => {
    let settleApproval: (() => void) | null = null;
    const { executor, runtime, queuePrepare, chainRef } = createExecutor({
      approvals: {
        create: vi.fn(() => ({
          approvalId: APPROVAL_ID,
          settled: new Promise<void>((resolve) => {
            settleApproval = resolve;
          }),
        })),
      },
    });

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(APPROVAL_ID);

    const handoff = await executor.beginTransactionApproval(
      {
        namespace: "eip155",
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      },
      REQUEST_CONTEXT,
    );

    randomUuidSpy.mockRestore();

    settleApproval?.();
    const result = await handoff.waitForApprovalDecision();

    expect(queuePrepare).toHaveBeenCalledWith(REQUEST_ID);
    expect(runtime.get(REQUEST_ID)?.chainRef).toBe(chainRef);
    expect(result).toMatchObject({ chainRef, namespace: "eip155" });
  });

  it("delegates chain-specific request derivation to the namespace transaction before runtime persistence", async () => {
    const deriveRequestForChain = vi.fn((request: TransactionMeta["request"], resolvedChainRef: string) => ({
      ...request,
      chainRef: resolvedChainRef,
      payload: {
        ...(request.payload as Record<string, unknown>),
        chainId: "0xa",
      },
    }));
    const { executor, runtime, chainRef } = createExecutor({
      namespaces: {
        get: () => ({
          deriveRequestForChain,
          receiptTracking: createReceiptTrackingStub(),
        }),
      },
    });

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(APPROVAL_ID);

    await executor.beginTransactionApproval(
      {
        namespace: "eip155",
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      },
      REQUEST_CONTEXT,
    );

    randomUuidSpy.mockRestore();

    expect(deriveRequestForChain).toHaveBeenCalledWith(
      {
        namespace: "eip155",
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      },
      chainRef,
    );
    expect(runtime.get(REQUEST_ID)?.request).toEqual({
      namespace: "eip155",
      chainRef,
      payload: expect.objectContaining({
        chainId: "0xa",
      }),
    });
  });

  it("rejects before creating approval when no namespace transaction is registered", async () => {
    const createApproval = vi.fn();
    const { executor, runtime } = createExecutor({
      namespaces: {
        get: () => undefined,
      },
      approvals: {
        create: createApproval,
      },
    });

    await expect(
      executor.beginTransactionApproval(
        {
          namespace: "eip155",
          payload: {
            from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
            data: "0x",
          },
        },
        REQUEST_CONTEXT,
      ),
    ).rejects.toMatchObject({
      name: "NamespaceTransactionMissingError",
    });

    expect(runtime.get(REQUEST_ID)).toBeUndefined();
    expect(createApproval).not.toHaveBeenCalled();
  });

  it("rejects before creating approval when request validation finds invalid fee fields", async () => {
    const createApproval = vi.fn();
    const { executor, runtime } = createExecutor({
      namespaces: {
        get: () => ({
          validateRequest: () => {
            throw arxError({
              reason: ArxReasons.RpcInvalidParams,
              message: "Cannot mix legacy gasPrice with EIP-1559 fields.",
              data: { code: "transaction.prepare.fee_conflict" },
            });
          },
          receiptTracking: createReceiptTrackingStub(),
        }),
      },
      approvals: {
        create: createApproval,
      },
    });

    await expect(
      executor.beginTransactionApproval(
        {
          namespace: "eip155",
          payload: {
            from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
            data: "0x",
          },
        },
        REQUEST_CONTEXT,
      ),
    ).rejects.toMatchObject({
      reason: ArxReasons.RpcInvalidParams,
      message: "Cannot mix legacy gasPrice with EIP-1559 fields.",
    });

    expect(runtime.get(REQUEST_ID)).toBeUndefined();
    expect(createApproval).not.toHaveBeenCalled();
  });

  it("passes owner validation context into request validation before creating approval", async () => {
    const validateRequest = vi.fn(() => {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "chainId does not match active chain.",
        data: { code: "transaction.prepare.chain_id_mismatch" },
      });
    });
    const { executor, chainRef } = createExecutor({
      namespaces: {
        get: () => ({
          validateRequest,
          receiptTracking: createReceiptTrackingStub(),
        }),
      },
    });

    await expect(
      executor.beginTransactionApproval(
        {
          namespace: "eip155",
          payload: {
            from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
            chainId: "0x1",
          },
        },
        REQUEST_CONTEXT,
      ),
    ).rejects.toMatchObject({
      reason: ArxReasons.RpcInvalidParams,
      message: "chainId does not match active chain.",
    });

    expect(validateRequest).toHaveBeenCalledWith({
      namespace: "eip155",
      chainRef,
      origin: REQUEST_CONTEXT.origin,
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      request: {
        namespace: "eip155",
        chainRef,
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          chainId: "0x1",
        },
      },
    });
  });

  it("fails with a stable namespace-transaction-missing error when execution reaches a namespace without a namespace transaction", async () => {
    const { executor, runtime } = createExecutor({
      namespaces: {
        get: () => undefined,
      },
    });

    runtime.create({
      id: REQUEST_ID,
      namespace: "eip155",
      chainRef: "eip155:10",
      origin: REQUEST_CONTEXT.origin,
      fromAccountKey: toAccountKeyFromAddress({
        chainRef: "eip155:10",
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        accountCodecs,
      }),
      request: {
        namespace: "eip155",
        chainRef: "eip155:10",
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      },
      prepared: {},
      status: "approved",
      createdAt: 1,
      updatedAt: 1,
    });

    await executor.processTransaction(REQUEST_ID);

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
    const { executor, runtime } = createExecutor();

    runtime.create({
      id: REQUEST_ID,
      namespace: "eip155",
      chainRef: "eip155:10",
      origin: REQUEST_CONTEXT.origin,
      fromAccountKey: toAccountKeyFromAddress({
        chainRef: "eip155:10",
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        accountCodecs,
      }),
      request: {
        namespace: "eip155",
        chainRef: "eip155:10",
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      },
      prepared: {},
      status: "signed",
      createdAt: 1,
      updatedAt: 1,
    });

    const rejectionError = Object.assign(new Error("User rejected transaction"), { code: 4001 });
    await executor.rejectTransaction(REQUEST_ID, rejectionError);

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
      chainRef: "eip155:10",
      origin: REQUEST_CONTEXT.origin,
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      request: null,
      prepared: null,
      status: "broadcast",
      submitted: {
        hash: "0x1234",
        chainId: "0xa",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
    const { executor } = createExecutor({
      service: {
        get: vi.fn(async () => toRecord(durableMeta)),
        transition,
      },
      view: {
        commitRecord,
      },
      tracking: {
        stop,
        handleTransition,
      },
    });

    await executor.rejectTransaction(REQUEST_ID, new Error("Transport disconnected."));

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
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        nonce: "0x7",
      },
      locator: {
        format: "eip155.tx_hash" as const,
        value: "0x2222222222222222222222222222222222222222222222222222222222222222",
      },
    }));
    const createSubmitted = vi.fn(
      async (input: {
        id: string;
        chainRef: string;
        origin: string;
        fromAccountKey: string;
        status: "broadcast";
        submitted: NonNullable<TransactionMeta["submitted"]>;
        locator: NonNullable<TransactionMeta["locator"]>;
        createdAt: number;
      }) => ({
        id: input.id,
        chainRef: input.chainRef,
        origin: input.origin,
        fromAccountKey: input.fromAccountKey,
        status: "broadcast" as const,
        submitted: input.submitted,
        locator: input.locator,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      }),
    );
    const handleTransition = vi.fn();
    const { executor, runtime, commitRecord } = createExecutor({
      namespaces: {
        get: () => ({
          receiptTracking: createReceiptTrackingStub(),
          signTransaction,
          broadcastTransaction,
        }),
      },
      service: {
        createSubmitted,
      },
      tracking: {
        handleTransition,
      },
    });

    runtime.create({
      id: REQUEST_ID,
      namespace: "eip155",
      chainRef: "eip155:10",
      origin: REQUEST_CONTEXT.origin,
      fromAccountKey: toAccountKeyFromAddress({
        chainRef: "eip155:10",
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        accountCodecs,
      }),
      request: {
        namespace: "eip155",
        chainRef: "eip155:10",
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
          nonce: "0x7",
        },
      },
      prepared: {
        nonce: "0x7",
      },
      status: "approved",
      createdAt: 1,
      updatedAt: 1,
    });

    await executor.processTransaction(REQUEST_ID);

    expect(signTransaction).toHaveBeenCalledTimes(1);
    expect(broadcastTransaction).toHaveBeenCalledTimes(1);
    expect(createSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({
        id: REQUEST_ID,
        status: "broadcast",
        submitted: {
          hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
          chainId: "0xa",
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          nonce: "0x7",
        },
        locator: {
          format: "eip155.tx_hash",
          value: "0x2222222222222222222222222222222222222222222222222222222222222222",
        },
      }),
    );
    expect(runtime.get(REQUEST_ID)).toBeUndefined();
    expect(commitRecord).toHaveBeenCalledTimes(1);
    expect(handleTransition).toHaveBeenCalledTimes(1);
  });

  it("reruns prepare after a draft edit invalidates an in-flight prepare result", async () => {
    const runtime = createRuntime();
    const reviewSessions = new TransactionReviewSessions();
    let prepareRun = 0;
    let releaseFirstPrepare: (() => void) | null = null;
    const firstPrepareSettled = new Promise<void>((resolve) => {
      releaseFirstPrepare = resolve;
    });
    const prepareTransaction = vi.fn(async (context: TransactionMeta) => {
      prepareRun += 1;
      if (prepareRun === 1) {
        await firstPrepareSettled;
        return {
          prepared: { gas: "0x5208", to: (context.request?.payload as { to?: string } | undefined)?.to ?? "old" },
          warnings: [],
          issues: [],
        };
      }

      return {
        prepared: { gas: "0x5300", to: (context.request?.payload as { to?: string } | undefined)?.to ?? "new" },
        warnings: [],
        issues: [],
      };
    });

    const prepare = new TransactionPrepareManager({
      runtime,
      namespaces: {
        get: () =>
          ({
            prepareTransaction,
            receiptTracking: createReceiptTrackingStub(),
          }) as never,
      } as never,
      reviewSessions,
    });

    const { executor } = createExecutor({
      runtime,
      namespaces: {
        get: () => ({
          prepareTransaction,
          applyDraftEdit: ({ request }: { request: TransactionMeta["request"] }) => ({
            ...request!,
            payload: {
              ...(request!.payload as Record<string, unknown>),
              to: "0xcccccccccccccccccccccccccccccccccccccccc",
            },
          }),
          receiptTracking: createReceiptTrackingStub(),
        }),
      },
      prepare: {
        queuePrepare: prepare.queuePrepare.bind(prepare),
        ensurePrepared: prepare.ensurePrepared.bind(prepare),
      },
    });

    runtime.create({
      id: REQUEST_ID,
      namespace: "eip155",
      chainRef: "eip155:10",
      origin: REQUEST_CONTEXT.origin,
      fromAccountKey: toAccountKeyFromAddress({
        chainRef: "eip155:10",
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        accountCodecs,
      }),
      request: {
        namespace: "eip155",
        chainRef: "eip155:10",
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
        },
      },
      status: "pending",
      createdAt: 1,
      updatedAt: 1,
    });

    const backgroundPrepare = prepare.ensurePrepared(REQUEST_ID, { source: "background" });
    await vi.waitFor(() => expect(prepareTransaction).toHaveBeenCalledTimes(1));

    const editPromise = executor
      .applyDraftEdit({
        transactionId: REQUEST_ID,
        changes: [{ op: "replace", path: "/to", value: "0xcccccccccccccccccccccccccccccccccccccccc" }],
      })
      .catch((error: unknown) => {
        throw error;
      });
    await Promise.resolve();
    releaseFirstPrepare?.();

    await editPromise;
    await backgroundPrepare;

    expect(prepareTransaction).toHaveBeenCalledTimes(2);
    expect(runtime.peek(REQUEST_ID)?.draftRevision).toBe(1);
    expect(runtime.get(REQUEST_ID)).toMatchObject({
      request: {
        payload: {
          to: "0xcccccccccccccccccccccccccccccccccccccccc",
        },
      },
      prepared: {
        gas: "0x5300",
        to: "0xcccccccccccccccccccccccccccccccccccccccc",
      },
    });
  });

  it("rejects draft edits after approval begins", async () => {
    const { executor, runtime } = createExecutor({
      namespaces: {
        get: () => ({
          applyDraftEdit: ({ request }: { request: TransactionMeta["request"] }) => request,
          receiptTracking: createReceiptTrackingStub(),
        }),
      },
    });

    runtime.create({
      id: REQUEST_ID,
      namespace: "eip155",
      chainRef: "eip155:10",
      origin: REQUEST_CONTEXT.origin,
      fromAccountKey: toAccountKeyFromAddress({
        chainRef: "eip155:10",
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        accountCodecs,
      }),
      request: {
        namespace: "eip155",
        chainRef: "eip155:10",
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
        },
      },
      prepared: { gas: "0x5208" },
      status: "approved",
      createdAt: 1,
      updatedAt: 1,
    });

    await expect(
      executor.applyDraftEdit({
        transactionId: REQUEST_ID,
        changes: [{ op: "replace", path: "/to", value: "0xcccccccccccccccccccccccccccccccccccccccc" }],
      }),
    ).rejects.toThrow("Transaction draft can only be edited before approval.");

    expect(runtime.peek(REQUEST_ID)?.draftRevision).toBe(0);
    expect(runtime.get(REQUEST_ID)?.request?.payload).toMatchObject({
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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

    const { executor, runtime } = createExecutor({
      namespaces: {
        get: () => ({
          receiptTracking: createReceiptTrackingStub(),
          signTransaction,
          broadcastTransaction,
        }),
      },
    });

    runtime.create({
      id: REQUEST_ID,
      namespace: "eip155",
      chainRef: "eip155:10",
      origin: REQUEST_CONTEXT.origin,
      fromAccountKey: toAccountKeyFromAddress({
        chainRef: "eip155:10",
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        accountCodecs,
      }),
      request: {
        namespace: "eip155",
        chainRef: "eip155:10",
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
        },
      },
      prepared: { gas: "0x5208" },
      status: "approved",
      createdAt: 1,
      updatedAt: 1,
    });

    const processing = executor.processTransaction(REQUEST_ID);
    await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(1));

    await executor.rejectTransaction(REQUEST_ID, new Error("User cancelled before submission"));
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
    const createSubmitted = vi.fn(
      async (input: {
        id: string;
        chainRef: string;
        origin: string;
        fromAccountKey: string;
        status: "broadcast";
        submitted: NonNullable<TransactionMeta["submitted"]>;
        locator: NonNullable<TransactionMeta["locator"]>;
        createdAt: number;
      }) => ({
        id: input.id,
        chainRef: input.chainRef,
        origin: input.origin,
        fromAccountKey: input.fromAccountKey,
        status: "broadcast" as const,
        submitted: input.submitted,
        locator: input.locator,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      }),
    );

    const { executor, runtime, commitRecord } = createExecutor({
      namespaces: {
        get: () => ({
          receiptTracking: createReceiptTrackingStub(),
          signTransaction,
          broadcastTransaction,
        }),
      },
      service: {
        createSubmitted,
      },
    });

    runtime.create({
      id: REQUEST_ID,
      namespace: "eip155",
      chainRef: "eip155:10",
      origin: REQUEST_CONTEXT.origin,
      fromAccountKey: toAccountKeyFromAddress({
        chainRef: "eip155:10",
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        accountCodecs,
      }),
      request: {
        namespace: "eip155",
        chainRef: "eip155:10",
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
        },
      },
      prepared: { gas: "0x5208" },
      status: "approved",
      createdAt: 1,
      updatedAt: 1,
    });

    const processing = executor.processTransaction(REQUEST_ID);
    await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(broadcastTransaction).toHaveBeenCalledTimes(1));

    await executor.rejectTransaction(REQUEST_ID, new Error("User cancelled too late"));
    releaseBroadcast?.();
    await processing;

    expect(createSubmitted).toHaveBeenCalledTimes(1);
    expect(runtime.get(REQUEST_ID)).toBeUndefined();
    expect(commitRecord).toHaveBeenCalledTimes(1);
  });

  it("re-enqueues approved runtime transactions when resuming pending work", async () => {
    const broadcastMeta: TransactionMeta = {
      id: "durable-tx",
      namespace: "eip155",
      chainRef: "eip155:10",
      origin: REQUEST_CONTEXT.origin,
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
    const { executor, runtime, chainRef, from } = createExecutor({
      service: {
        list,
      },
      tracking: {
        handleTransition: vi.fn(),
        resumeBroadcast,
      },
      view: {
        commitRecord,
      },
    });

    runtime.create({
      id: REQUEST_ID,
      namespace: "eip155",
      chainRef,
      origin: REQUEST_CONTEXT.origin,
      fromAccountKey: toAccountKeyFromAddress({ chainRef, address: from, accountCodecs }),
      request: {
        namespace: "eip155",
        chainRef,
        payload: { from, to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", value: "0x0" },
      },
      prepared: { gas: "0x5208" },
      status: "approved",
      createdAt: 1,
      updatedAt: 1,
    });
    runtime.create({
      id: "signed-tx",
      namespace: "eip155",
      chainRef,
      origin: REQUEST_CONTEXT.origin,
      fromAccountKey: toAccountKeyFromAddress({ chainRef, address: from, accountCodecs }),
      request: {
        namespace: "eip155",
        chainRef,
        payload: { from, to: "0xcccccccccccccccccccccccccccccccccccccccc", value: "0x0" },
      },
      prepared: { gas: "0x5208" },
      status: "signed",
      createdAt: 1,
      updatedAt: 1,
    });

    const processSpy = vi.spyOn(executor, "processTransaction").mockImplementation(processTransaction);

    await executor.resumePending();
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

  it("resets signed runtime transactions to approved when signing is interrupted by lock", async () => {
    const lockError = arxError({
      reason: ArxReasons.SessionLocked,
      message: "Wallet is locked.",
    });
    const broadcastTransaction = vi.fn();
    const { executor, runtime } = createExecutor({
      namespaces: {
        get: () => ({
          receiptTracking: createReceiptTrackingStub(),
          signTransaction: vi.fn(async () => {
            throw lockError;
          }),
          broadcastTransaction,
        }),
      },
    });

    runtime.create({
      id: REQUEST_ID,
      namespace: "eip155",
      chainRef: "eip155:10",
      origin: REQUEST_CONTEXT.origin,
      fromAccountKey: toAccountKeyFromAddress({
        chainRef: "eip155:10",
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        accountCodecs,
      }),
      request: {
        namespace: "eip155",
        chainRef: "eip155:10",
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
        },
      },
      prepared: { gas: "0x5208" },
      status: "approved",
      createdAt: 1,
      updatedAt: 1,
    });

    await executor.processTransaction(REQUEST_ID);

    expect(runtime.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "approved",
    });
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });
});
