import { ArxReasons, arxError } from "@arx/errors";
import { describe, expect, it, vi } from "vitest";
import type { TransactionRequest } from "../../transactions/types.js";
import {
  APPROVAL_ID,
  accountCodecs,
  createAccountControllerStub,
  createNamespacesStub,
  createNamespaceTransactionStub,
  createPrepareStub,
  createRuntime,
  createRuntimeTransaction,
  createViewStub,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  DEFAULT_TO,
  markReviewReady,
  REQUEST_CONTEXT,
  REQUEST_ID,
} from "./__fixtures__/transactionServices.js";
import { TransactionReviewSessions } from "./review/session.js";
import { TransactionPrepareManager } from "./TransactionPrepareManager.js";
import { TransactionProposalService } from "./TransactionProposalService.js";
import type { TransactionMeta } from "./types.js";

const createProposalService = (params?: {
  chainRef?: string;
  from?: string;
  runtime?: ReturnType<typeof createRuntime>;
  reviewSessions?: TransactionReviewSessions;
  namespaces?: ReturnType<typeof createNamespacesStub>;
  approvals?: {
    create: (...args: never[]) => unknown;
  };
  prepare?: ReturnType<typeof createPrepareStub>;
  view?: ReturnType<typeof createViewStub>;
}) => {
  const chainRef = params?.chainRef ?? DEFAULT_CHAIN_REF;
  const from = params?.from ?? DEFAULT_FROM;
  const runtime = params?.runtime ?? createRuntime();
  const reviewSessions = params?.reviewSessions ?? new TransactionReviewSessions();
  const queuePrepare = vi.fn();
  const prepare = params?.prepare ?? createPrepareStub({ queuePrepare });
  const createApproval =
    params?.approvals?.create ??
    vi.fn(() => ({
      approvalId: APPROVAL_ID,
      settled: Promise.resolve(undefined),
    }));
  const service = new TransactionProposalService({
    runtime,
    view: params?.view ?? createViewStub({ from }),
    accountCodecs,
    networkSelection: {
      getSelectedChainRef: (namespace: string) => (namespace === "eip155" ? chainRef : null),
    },
    supportedChains: {
      getChain: () => null,
    },
    accounts: createAccountControllerStub({ chainRef, from }),
    approvals: {
      create: createApproval as never,
    },
    namespaces: (params?.namespaces ?? createNamespacesStub()) as never,
    prepare: prepare as never,
    reviewSessions,
    readTransactionTimestamp: () => 1,
  });

  return {
    service,
    runtime,
    reviewSessions,
    queuePrepare,
    createApproval,
    chainRef,
    from,
  };
};

describe("TransactionProposalService", () => {
  it("begins a transaction approval with a linked but distinct approval id", async () => {
    let settleApproval: (() => void) | null = null;
    const createApproval = vi.fn(() => ({
      approvalId: APPROVAL_ID,
      settled: new Promise<void>((resolve) => {
        settleApproval = resolve;
      }),
    }));
    const { service, runtime, queuePrepare, chainRef } = createProposalService({
      approvals: {
        create: createApproval as never,
      },
    });

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(APPROVAL_ID);

    const handoff = await service.beginTransactionApproval(
      {
        namespace: "eip155",
        payload: {
          from: DEFAULT_FROM,
          to: DEFAULT_TO,
          value: "0x0",
          data: "0x",
        },
      },
      REQUEST_CONTEXT,
      { from: DEFAULT_FROM },
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
    const { service } = createProposalService({
      approvals: {
        create: createApproval as never,
      },
    });

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(APPROVAL_ID);

    const handoff = await service.beginTransactionApproval(
      {
        namespace: "eip155",
        payload: {
          from: DEFAULT_FROM,
          to: DEFAULT_TO,
          value: "0x0",
          data: "0x",
        },
      },
      REQUEST_CONTEXT,
      {
        from: DEFAULT_FROM,
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
      data: { portId: REQUEST_CONTEXT.portId },
    });
    const queuePrepare = vi.fn();
    const { service, runtime } = createProposalService({
      prepare: createPrepareStub({
        queuePrepare,
      }),
    });

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(APPROVAL_ID);

    await expect(
      service.beginTransactionApproval(
        {
          namespace: "eip155",
          payload: {
            from: DEFAULT_FROM,
            to: DEFAULT_TO,
            value: "0x0",
            data: "0x",
          },
        },
        REQUEST_CONTEXT,
        {
          from: DEFAULT_FROM,
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
        name: "ArxError",
        message: "Transport disconnected.",
        data: { portId: REQUEST_CONTEXT.portId },
      },
      userRejected: false,
    });
  });

  it("uses namespace-specific active chain when request.chainRef is absent", async () => {
    let settleApproval: (() => void) | null = null;
    const { service, runtime, queuePrepare, chainRef } = createProposalService({
      approvals: {
        create: vi.fn(() => ({
          approvalId: APPROVAL_ID,
          settled: new Promise<void>((resolve) => {
            settleApproval = resolve;
          }),
        })) as never,
      },
    });

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(APPROVAL_ID);

    const handoff = await service.beginTransactionApproval(
      {
        namespace: "eip155",
        payload: {
          from: DEFAULT_FROM,
          to: DEFAULT_TO,
          value: "0x0",
          data: "0x",
        },
      },
      REQUEST_CONTEXT,
      { from: DEFAULT_FROM },
    );

    randomUuidSpy.mockRestore();

    settleApproval?.();
    const result = await handoff.waitForApprovalDecision();

    expect(queuePrepare).toHaveBeenCalledWith(REQUEST_ID);
    expect(runtime.get(REQUEST_ID)?.chainRef).toBe(chainRef);
    expect(result).toMatchObject({ chainRef, namespace: "eip155" });
  });

  it("delegates chain-specific request derivation to the namespace transaction before runtime persistence", async () => {
    const deriveRequestForChain = vi.fn((request: TransactionRequest, resolvedChainRef: string) => ({
      ...request,
      chainRef: resolvedChainRef,
      payload: {
        ...request.payload,
        chainId: "0xa",
      },
    }));
    const { service, runtime, chainRef } = createProposalService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          deriveForChain: deriveRequestForChain as never,
        }),
      ),
    });

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(APPROVAL_ID);

    await service.beginTransactionApproval(
      {
        namespace: "eip155",
        payload: {
          from: DEFAULT_FROM,
          to: DEFAULT_TO,
          value: "0x0",
          data: "0x",
        },
      },
      REQUEST_CONTEXT,
      { from: DEFAULT_FROM },
    );

    randomUuidSpy.mockRestore();

    expect(deriveRequestForChain).toHaveBeenCalledWith(
      {
        namespace: "eip155",
        payload: {
          from: DEFAULT_FROM,
          to: DEFAULT_TO,
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
    const { service, runtime } = createProposalService({
      namespaces: createNamespacesStub(() => undefined),
      approvals: {
        create: createApproval as never,
      },
    });

    await expect(
      service.beginTransactionApproval(
        {
          namespace: "eip155",
          payload: {
            from: DEFAULT_FROM,
            to: DEFAULT_TO,
            value: "0x0",
            data: "0x",
          },
        },
        REQUEST_CONTEXT,
        { from: DEFAULT_FROM },
      ),
    ).rejects.toMatchObject({
      name: "NamespaceTransactionMissingError",
    });

    expect(runtime.get(REQUEST_ID)).toBeUndefined();
    expect(createApproval).not.toHaveBeenCalled();
  });

  it("rejects before creating approval when request validation finds invalid fee fields", async () => {
    const createApproval = vi.fn();
    const { service, runtime } = createProposalService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          validate: () => {
            throw arxError({
              reason: ArxReasons.RpcInvalidParams,
              message: "Cannot mix legacy gasPrice with EIP-1559 fields.",
              data: { code: "transaction.prepare.fee_conflict" },
            });
          },
        }),
      ),
      approvals: {
        create: createApproval as never,
      },
    });

    await expect(
      service.beginTransactionApproval(
        {
          namespace: "eip155",
          payload: {
            from: DEFAULT_FROM,
            to: DEFAULT_TO,
            value: "0x0",
            data: "0x",
          },
        },
        REQUEST_CONTEXT,
        { from: DEFAULT_FROM },
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
        message: "Transaction chainId does not match the active chain.",
        data: { code: "transaction.prepare.chain_id_mismatch" },
      });
    });
    const { service, chainRef } = createProposalService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          validate: validateRequest as never,
        }),
      ),
    });

    await expect(
      service.beginTransactionApproval(
        {
          namespace: "eip155",
          payload: {
            from: DEFAULT_FROM,
            to: DEFAULT_TO,
            value: "0x0",
            chainId: "0x1",
          },
        },
        REQUEST_CONTEXT,
        { from: DEFAULT_FROM },
      ),
    ).rejects.toMatchObject({
      reason: ArxReasons.RpcInvalidParams,
      message: "Transaction chainId does not match the active chain.",
    });

    expect(validateRequest).toHaveBeenCalledWith({
      namespace: "eip155",
      chainRef,
      origin: REQUEST_CONTEXT.origin,
      from: DEFAULT_FROM,
      request: {
        namespace: "eip155",
        chainRef,
        payload: {
          from: DEFAULT_FROM,
          to: DEFAULT_TO,
          value: "0x0",
          chainId: "0x1",
        },
      },
    });
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
          status: "ready" as const,
          prepared: {
            gas: "0x5208",
            to: (context.request?.payload as { to?: string } | undefined)?.to ?? "old",
          },
        };
      }

      return {
        status: "ready" as const,
        prepared: {
          gas: "0x5300",
          to: (context.request?.payload as { to?: string } | undefined)?.to ?? "new",
        },
      };
    });

    const namespaces = createNamespacesStub(() =>
      createNamespaceTransactionStub({
        prepare: prepareTransaction as never,
        applyDraftEdit: (({ request }: { request: NonNullable<TransactionMeta["request"]> }) => ({
          ...request,
          payload: {
            ...request.payload,
            to: "0xcccccccccccccccccccccccccccccccccccccccc",
          },
        })) as never,
      }),
    );
    const prepare = new TransactionPrepareManager({
      runtime,
      namespaces: namespaces as never,
      reviewSessions,
    });

    const { service } = createProposalService({
      runtime,
      reviewSessions,
      namespaces,
      prepare: prepare as never,
    });

    createRuntimeTransaction(runtime, {
      request: {
        namespace: "eip155",
        chainRef: DEFAULT_CHAIN_REF,
        payload: {
          from: DEFAULT_FROM,
          to: DEFAULT_TO,
          value: "0x0",
        },
      },
      status: "pending",
      createdAt: 1,
      updatedAt: 1,
    });

    const backgroundPrepare = prepare.prepareTransactionForExecution(REQUEST_ID);
    await vi.waitFor(() => expect(prepareTransaction).toHaveBeenCalledTimes(1));

    const editPromise = service.applyDraftEdit({
      transactionId: REQUEST_ID,
      changes: [{ op: "replace", path: "/to", value: "0xcccccccccccccccccccccccccccccccccccccccc" }],
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
    const { service, runtime } = createProposalService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          applyDraftEdit: (({ request }: { request: TransactionMeta["request"] }) => request) as never,
        }),
      ),
    });

    createRuntimeTransaction(runtime, {
      prepared: { gas: "0x5208" },
      status: "approved",
    });

    await expect(
      service.applyDraftEdit({
        transactionId: REQUEST_ID,
        changes: [{ op: "replace", path: "/to", value: "0xcccccccccccccccccccccccccccccccccccccccc" }],
      }),
    ).rejects.toThrow("Transaction draft can only be edited before approval.");

    expect(runtime.peek(REQUEST_ID)?.draftRevision).toBe(0);
    expect(runtime.get(REQUEST_ID)?.request?.payload).toMatchObject({
      to: DEFAULT_TO,
    });
  });

  it("approves only ready prepared proposals for execution", () => {
    const { service, runtime, reviewSessions } = createProposalService();
    createRuntimeTransaction(runtime, {
      status: "pending",
    });
    runtime.commitPrepared(REQUEST_ID, 0, { gas: "0x5208" });
    markReviewReady(reviewSessions, REQUEST_ID);

    expect(service.approveForExecution(REQUEST_ID)).toMatchObject({
      status: "approved",
      transaction: {
        id: REQUEST_ID,
        status: "approved",
      },
    });
  });

  it("rejects execution approval when prepared params do not belong to the current draft", () => {
    const { service, runtime, reviewSessions } = createProposalService();
    createRuntimeTransaction(runtime, {
      status: "pending",
    });
    runtime.commitPrepared(REQUEST_ID, 0, { gas: "0x5208" });
    runtime.replaceDraftRequest({
      id: REQUEST_ID,
      fromStatus: "pending",
      request: {
        namespace: "eip155",
        chainRef: DEFAULT_CHAIN_REF,
        payload: {
          from: DEFAULT_FROM,
          to: DEFAULT_TO,
          value: "0x1",
        },
      },
      updatedAt: 2,
    });
    runtime.patch(REQUEST_ID, { prepared: { gas: "0x5208" } });
    markReviewReady(reviewSessions, REQUEST_ID);

    expect(service.approveForExecution(REQUEST_ID)).toMatchObject({
      status: "failed",
      reason: "prepare_not_ready",
      data: {
        transactionId: REQUEST_ID,
      },
    });
    expect(runtime.get(REQUEST_ID)?.status).toBe("pending");
  });

  it("blocks execution approval when review is not ready", () => {
    const { service, runtime, reviewSessions } = createProposalService();
    createRuntimeTransaction(runtime, {
      prepared: null,
      status: "pending",
    });
    reviewSessions.begin(REQUEST_ID, 1);

    expect(service.approveForExecution(REQUEST_ID)).toMatchObject({
      status: "failed",
      reason: "prepare_not_ready",
      data: {
        transactionId: REQUEST_ID,
        prepareState: "preparing",
      },
    });
    expect(runtime.get(REQUEST_ID)?.status).toBe("pending");
  });

  it("projects namespace review from the review prepared snapshot", () => {
    const buildReview = vi.fn(() => ({
      namespace: "eip155" as const,
      summary: {
        from: DEFAULT_FROM,
        to: DEFAULT_TO,
        value: "0x1",
      },
      execution: {
        gas: "0x5208",
      },
    }));
    const { service, runtime, reviewSessions } = createProposalService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          buildReview: buildReview as never,
        }),
      ),
    });
    createRuntimeTransaction(runtime, {
      request: {
        namespace: "eip155",
        chainRef: DEFAULT_CHAIN_REF,
        payload: {
          from: DEFAULT_FROM,
          to: DEFAULT_TO,
          value: "0x1",
        },
      },
      status: "pending",
    });
    const session = reviewSessions.begin(REQUEST_ID, 1);
    reviewSessions.markBlocked(
      REQUEST_ID,
      session.sessionToken,
      2,
      {
        reason: "transaction.prepare.insufficient_funds",
        message: "Insufficient funds for transaction.",
      },
      {
        gas: "0x5208",
      },
    );

    expect(service.getApprovalReview({ transactionId: REQUEST_ID })).toMatchObject({
      updatedAt: 2,
      prepare: {
        state: "blocked",
      },
      namespaceReview: {
        execution: {
          gas: "0x5208",
        },
      },
    });
    expect(buildReview).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewPreparedSnapshot: {
          gas: "0x5208",
        },
      }),
    );
  });
});
