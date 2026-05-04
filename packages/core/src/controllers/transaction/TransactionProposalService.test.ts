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
  createProposalStore,
  createReviewSessionStore,
  createTransactionProposal,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  DEFAULT_TO,
  markReviewReady,
  REQUEST_CONTEXT,
  REQUEST_ID,
} from "./__fixtures__/transactionServices.js";
import { createTransactionApprovalReviewReader } from "./TransactionApprovalReviewService.js";
import { TransactionPrepareManager } from "./TransactionPrepareManager.js";
import { TransactionProposalService } from "./TransactionProposalService.js";
import type { TransactionProposalMeta } from "./types.js";

const createProposalService = (params?: {
  chainRef?: string;
  from?: string;
  proposalStore?: ReturnType<typeof createProposalStore>;
  reviewStore?: ReturnType<typeof createReviewSessionStore>;
  namespaces?: ReturnType<typeof createNamespacesStub>;
  approvals?: {
    create: (...args: never[]) => unknown;
  };
  prepare?: ReturnType<typeof createPrepareStub>;
}) => {
  const chainRef = params?.chainRef ?? DEFAULT_CHAIN_REF;
  const from = params?.from ?? DEFAULT_FROM;
  const proposalStore = params?.proposalStore ?? createProposalStore();
  const reviewStore = params?.reviewStore ?? createReviewSessionStore();
  const namespaces = params?.namespaces ?? createNamespacesStub();
  const queuePrepare = vi.fn();
  const prepare = params?.prepare ?? createPrepareStub({ queuePrepare });
  const createApproval =
    params?.approvals?.create ??
    vi.fn(() => ({
      approvalId: APPROVAL_ID,
      settled: Promise.resolve(undefined),
    }));
  const review = createTransactionApprovalReviewReader({
    proposalStore,
    reviewSessions: reviewStore,
    namespaces: namespaces as never,
  });
  const service = new TransactionProposalService({
    proposalStore,
    reviewSessions: reviewStore,
    review,
    accountCodecs,
    networkSelection: {
      getSelectedChainRef: (namespace: string) => (namespace === "eip155" ? chainRef : null),
    },
    accounts: createAccountControllerStub({ chainRef, from }),
    approvals: {
      create: createApproval as never,
    },
    namespaces: namespaces as never,
    prepare: prepare as never,
    readTransactionTimestamp: () => 1,
  });

  return {
    service,
    review,
    proposalStore,
    reviewStore,
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
    const { service, proposalStore, reviewStore, queuePrepare, chainRef } = createProposalService({
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
    });
    expect(proposalStore.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "pending",
      chainRef,
    });
    expect(queuePrepare).toHaveBeenCalledWith(REQUEST_ID);
    expect(reviewStore.get(REQUEST_ID)).toMatchObject({
      status: "preparing",
      reviewPreparedSnapshot: null,
    });
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
    expect(service.getProposalView(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      kind: "proposal",
      phase: "pending",
    });
  });

  it("attaches transaction approvals through the provided approval binding", async () => {
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
        requestBinding: {
          id: REQUEST_CONTEXT.requestId,
          attachBlockingApproval,
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

  it("fails the proposal if provider scope is lost before approval attach completes", async () => {
    const attachFailure = arxError({
      reason: ArxReasons.TransportDisconnected,
      message: "Transport disconnected.",
      data: { portId: REQUEST_CONTEXT.portId },
    });
    const queuePrepare = vi.fn();
    const { service, proposalStore } = createProposalService({
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
          requestBinding: {
            id: REQUEST_CONTEXT.requestId,
            attachBlockingApproval: () => {
              throw attachFailure;
            },
          },
        },
      ),
    ).rejects.toBe(attachFailure);

    randomUuidSpy.mockRestore();

    expect(queuePrepare).not.toHaveBeenCalled();
    expect(proposalStore.get(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      status: "failed",
      error: {
        name: "TransportDisconnectedError",
        message: "Transport disconnected.",
        data: { portId: REQUEST_CONTEXT.portId },
      },
      userRejected: false,
    });
  });

  it("uses namespace-specific active chain when request.chainRef is absent", async () => {
    let settleApproval: (() => void) | null = null;
    const { service, proposalStore, queuePrepare, chainRef } = createProposalService({
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
    await Promise.resolve();

    expect(queuePrepare).toHaveBeenCalledWith(REQUEST_ID);
    expect(proposalStore.get(REQUEST_ID)?.chainRef).toBe(chainRef);
    expect(service.getProposalView(REQUEST_ID)).toMatchObject({ chainRef, namespace: "eip155" });
  });

  it("delegates chain-specific request derivation to the namespace transaction before proposal store persistence", async () => {
    const deriveRequestForChain = vi.fn((request: TransactionRequest, resolvedChainRef: string) => ({
      ...request,
      chainRef: resolvedChainRef,
      payload: {
        ...request.payload,
        chainId: "0xa",
      },
    }));
    const { service, proposalStore, chainRef } = createProposalService({
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
    expect(proposalStore.get(REQUEST_ID)?.request).toEqual({
      namespace: "eip155",
      chainRef,
      payload: expect.objectContaining({
        chainId: "0xa",
      }),
    });
  });

  it("rejects before creating approval when no namespace transaction is registered", async () => {
    const createApproval = vi.fn();
    const { service, proposalStore } = createProposalService({
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

    expect(proposalStore.get(REQUEST_ID)).toBeUndefined();
    expect(createApproval).not.toHaveBeenCalled();
  });

  it("rejects before creating approval when request validation finds invalid fee fields", async () => {
    const createApproval = vi.fn();
    const { service, proposalStore } = createProposalService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          validateRequest: () => {
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

    expect(proposalStore.get(REQUEST_ID)).toBeUndefined();
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
          validateRequest: validateRequest as never,
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

  it("derives the namespace request before validateRequest runs", async () => {
    const calls: string[] = [];
    const deriveForChain = vi.fn((request: TransactionRequest, resolvedChainRef: string) => {
      calls.push("deriveForChain");
      return {
        ...request,
        chainRef: resolvedChainRef,
        payload: {
          ...request.payload,
          chainId: "0xa",
        },
      };
    });
    const validateRequest = vi.fn((context: { request: TransactionRequest }) => {
      calls.push("validateRequest");
      expect(context.request).toEqual({
        namespace: "eip155",
        chainRef: DEFAULT_CHAIN_REF,
        payload: {
          from: DEFAULT_FROM,
          to: DEFAULT_TO,
          value: "0x0",
          chainId: "0xa",
        },
      });
    });
    const { service } = createProposalService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          deriveForChain: deriveForChain as never,
          validateRequest: validateRequest as never,
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
        },
      },
      REQUEST_CONTEXT,
      { from: DEFAULT_FROM },
    );

    randomUuidSpy.mockRestore();

    expect(calls).toEqual(["deriveForChain", "validateRequest"]);
    expect(deriveForChain).toHaveBeenCalledTimes(1);
    expect(validateRequest).toHaveBeenCalledTimes(1);
  });

  it("reruns prepare after a draft edit invalidates an in-flight prepare result", async () => {
    const proposalStore = createProposalStore();
    const reviewStore = createReviewSessionStore();
    let prepareRun = 0;
    let releaseFirstPrepare: (() => void) | null = null;
    const firstPrepareSettled = new Promise<void>((resolve) => {
      releaseFirstPrepare = resolve;
    });
    const prepareTransaction = vi.fn(async (context: TransactionProposalMeta) => {
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
        applyDraftEdit: (({ request }: { request: NonNullable<TransactionProposalMeta["request"]> }) => ({
          ...request,
          payload: {
            ...request.payload,
            to: "0xcccccccccccccccccccccccccccccccccccccccc",
          },
        })) as never,
      }),
    );
    const prepare = new TransactionPrepareManager({
      proposalStore,
      reviewSessions: reviewStore,
      namespaces: namespaces as never,
    });

    const { service } = createProposalService({
      proposalStore,
      reviewStore,
      namespaces,
      prepare: prepare as never,
    });

    createTransactionProposal(proposalStore, {
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
    expect(proposalStore.peek(REQUEST_ID)?.draftRevision).toBe(1);
    expect(reviewStore.get(REQUEST_ID)).toMatchObject({
      status: "ready",
      reviewPreparedSnapshot: {
        gas: "0x5300",
        to: "0xcccccccccccccccccccccccccccccccccccccccc",
      },
    });
    expect(proposalStore.get(REQUEST_ID)).toMatchObject({
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

  it("resets review state to preparing immediately after a draft edit", async () => {
    let releasePrepare: (() => void) | null = null;
    const prepareStarted = new Promise<void>((resolve) => {
      releasePrepare = resolve;
    });
    const proposalStore = createProposalStore();
    const reviewStore = createReviewSessionStore();
    const prepareTransaction = vi.fn(async () => {
      await prepareStarted;
      return {
        status: "ready" as const,
        prepared: {
          gas: "0x5300",
        },
      };
    });
    const namespaces = createNamespacesStub(() =>
      createNamespaceTransactionStub({
        prepare: prepareTransaction as never,
        applyDraftEdit: (({ request }: { request: NonNullable<TransactionProposalMeta["request"]> }) => ({
          ...request,
          payload: {
            ...request.payload,
            to: "0xcccccccccccccccccccccccccccccccccccccccc",
          },
        })) as never,
      }),
    );
    const prepare = new TransactionPrepareManager({
      proposalStore,
      reviewSessions: reviewStore,
      namespaces: namespaces as never,
    });
    const { service } = createProposalService({
      proposalStore,
      reviewStore,
      namespaces,
      prepare: prepare as never,
    });

    createTransactionProposal(proposalStore, {
      status: "pending",
    });
    markReviewReady(proposalStore, reviewStore, REQUEST_ID, {
      reviewPreparedSnapshot: { gas: "0x5208" },
    });

    const editPromise = service.applyDraftEdit({
      transactionId: REQUEST_ID,
      changes: [{ op: "replace", path: "/to", value: "0xcccccccccccccccccccccccccccccccccccccccc" }],
    });
    await Promise.resolve();

    expect(reviewStore.get(REQUEST_ID)).toMatchObject({
      status: "preparing",
      reviewPreparedSnapshot: null,
      blocker: null,
      error: null,
    });

    releasePrepare?.();
    await editPromise;
  });

  it("rejects draft edits after approval begins", async () => {
    const { service, proposalStore } = createProposalService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          applyDraftEdit: (({ request }: { request: TransactionProposalMeta["request"] }) => request) as never,
        }),
      ),
    });

    createTransactionProposal(proposalStore, {
      prepared: { gas: "0x5208" },
      status: "approved",
    });

    await expect(
      service.applyDraftEdit({
        transactionId: REQUEST_ID,
        changes: [{ op: "replace", path: "/to", value: "0xcccccccccccccccccccccccccccccccccccccccc" }],
      }),
    ).rejects.toThrow("Transaction draft can only be edited before approval.");

    expect(proposalStore.peek(REQUEST_ID)?.draftRevision).toBe(0);
    expect(proposalStore.get(REQUEST_ID)?.request?.payload).toMatchObject({
      to: DEFAULT_TO,
    });
  });

  it("approves only ready prepared proposals for execution", () => {
    const { service, proposalStore, reviewStore } = createProposalService();
    createTransactionProposal(proposalStore, {
      status: "pending",
    });
    proposalStore.commitPrepared(REQUEST_ID, 0, { gas: "0x5208" });
    markReviewReady(proposalStore, reviewStore, REQUEST_ID);

    expect(service.approveForExecution(REQUEST_ID)).toMatchObject({
      status: "approved",
      transaction: {
        id: REQUEST_ID,
        kind: "proposal",
        phase: "approved",
      },
    });
  });

  it("rejects execution approval when the review session is missing even if prepared params exist", () => {
    const { service, proposalStore } = createProposalService();
    createTransactionProposal(proposalStore, {
      status: "pending",
    });
    proposalStore.commitPrepared(REQUEST_ID, 0, { gas: "0x5208" });

    expect(service.approveForExecution(REQUEST_ID)).toMatchObject({
      status: "failed",
      reason: "prepare_not_ready",
      data: {
        transactionId: REQUEST_ID,
        prepareState: "missing_review_session",
      },
    });
  });

  it("rejects execution approval when prepared params do not belong to the current draft", () => {
    const { service, proposalStore, reviewStore } = createProposalService();
    createTransactionProposal(proposalStore, {
      status: "pending",
    });
    proposalStore.commitPrepared(REQUEST_ID, 0, { gas: "0x5208" });
    proposalStore.replacePendingDraftRequest({
      id: REQUEST_ID,
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
    proposalStore.patch(REQUEST_ID, { prepared: { gas: "0x5208" } });
    markReviewReady(proposalStore, reviewStore, REQUEST_ID);

    expect(service.approveForExecution(REQUEST_ID)).toMatchObject({
      status: "failed",
      reason: "prepare_not_ready",
      data: {
        transactionId: REQUEST_ID,
      },
    });
    expect(proposalStore.get(REQUEST_ID)?.status).toBe("pending");
  });

  it("blocks execution approval when review is not ready", () => {
    const { service, proposalStore, reviewStore } = createProposalService();
    createTransactionProposal(proposalStore, {
      prepared: null,
      status: "pending",
    });
    reviewStore.beginPrepareSession({ id: REQUEST_ID, draftRevision: 0, updatedAt: 1 });

    expect(service.approveForExecution(REQUEST_ID)).toMatchObject({
      status: "failed",
      reason: "prepare_not_ready",
      data: {
        transactionId: REQUEST_ID,
        prepareState: "preparing",
      },
    });
    expect(proposalStore.get(REQUEST_ID)?.status).toBe("pending");
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
    const { review, proposalStore, reviewStore } = createProposalService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          buildReview: buildReview as never,
        }),
      ),
    });
    createTransactionProposal(proposalStore, {
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
    const current = proposalStore.peek(REQUEST_ID);
    const session = reviewStore.beginPrepareSession({
      id: REQUEST_ID,
      draftRevision: current?.draftRevision ?? 0,
      updatedAt: 1,
    });
    reviewStore.markReviewBlocked({
      id: REQUEST_ID,
      expectedDraftRevision: current?.draftRevision ?? 0,
      sessionToken: session.sessionToken,
      updatedAt: 2,
      blocker: {
        reason: "transaction.prepare.insufficient_funds",
        message: "Insufficient funds for transaction.",
      },
      reviewPreparedSnapshot: {
        gas: "0x5208",
      },
    });

    expect(review.getTransactionApprovalReview(REQUEST_ID)).toMatchObject({
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

  it("throws when the proposal is missing", () => {
    const buildReview = vi.fn();
    const { review } = createProposalService({
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          buildReview: buildReview as never,
        }),
      ),
    });

    expect(() => review.getTransactionApprovalReview(REQUEST_ID)).toThrow("missing an active proposal");
    expect(buildReview).not.toHaveBeenCalled();
  });

  it("throws when an active proposal is missing a review session", () => {
    const { review, proposalStore } = createProposalService();
    createTransactionProposal(proposalStore, {
      status: "pending",
    });

    expect(() => review.getTransactionApprovalReview(REQUEST_ID)).toThrow("is missing an active review session");
  });
});
