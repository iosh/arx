import { describe, expect, it } from "vitest";
import {
  createProposalStore,
  createReviewStore,
  createTransactionProposal,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  DEFAULT_TO,
  REQUEST_CONTEXT,
  REQUEST_ID,
} from "./__fixtures__/transactionServices.js";
import { TransactionProposalApprovalService } from "./TransactionProposalApprovalService.js";

const createApprovalService = (params?: {
  proposalStore?: ReturnType<typeof createProposalStore>;
  reviewStore?: ReturnType<typeof createReviewStore>;
}) => {
  const proposalStore = params?.proposalStore ?? createProposalStore();
  const reviewStore = params?.reviewStore ?? createReviewStore();

  return {
    proposalStore,
    reviewStore,
    service: new TransactionProposalApprovalService({
      proposalStore,
      reviewStore,
      now: () => 1,
    }),
  };
};

describe("TransactionProposalApprovalService", () => {
  it("approves only ready proposals with current prepared params", () => {
    const { service, proposalStore, reviewStore } = createApprovalService();

    createTransactionProposal(proposalStore, reviewStore, {
      status: "pending",
    });
    const current = proposalStore.peek(REQUEST_ID);
    if (!current) {
      throw new Error("Proposal not found");
    }

    const session = reviewStore.getOrStartPrepare({
      id: REQUEST_ID,
      draftRevision: current.draftRevision,
      updatedAt: 1,
    });
    reviewStore.settlePrepareReady({
      id: REQUEST_ID,
      expectedDraftRevision: current.draftRevision,
      sessionToken: session.sessionToken,
      updatedAt: 1,
      reviewPreparedSnapshot: { gas: "0x5208" },
    });
    proposalStore.updatePreparedForDraft({
      id: REQUEST_ID,
      expectedDraftRevision: current.draftRevision,
      updatedAt: 1,
      prepared: { gas: "0x5208" },
    });

    expect(service.approvePendingProposal(REQUEST_ID)).toEqual({
      status: "approved",
      transactionId: REQUEST_ID,
    });
    expect(proposalStore.get(REQUEST_ID)).toMatchObject({
      status: "approved",
      prepared: { gas: "0x5208" },
    });
  });

  it("fails when the review state is missing", () => {
    const { service, proposalStore, reviewStore } = createApprovalService();
    createTransactionProposal(proposalStore, reviewStore, { status: "pending" });

    expect(service.approvePendingProposal(REQUEST_ID)).toMatchObject({
      status: "failed",
      reason: "prepare_not_ready",
      data: {
        transactionId: REQUEST_ID,
        prepareState: "missing_review",
      },
    });
  });

  it("fails when the current draft revision no longer matches the review", () => {
    const { service, proposalStore, reviewStore } = createApprovalService();
    createTransactionProposal(proposalStore, reviewStore, { status: "pending" });

    const current = proposalStore.peek(REQUEST_ID);
    if (!current) {
      throw new Error("Proposal not found");
    }
    const session = reviewStore.getOrStartPrepare({
      id: REQUEST_ID,
      draftRevision: current.draftRevision,
      updatedAt: 1,
    });
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

    expect(
      reviewStore.settlePrepareReady({
        id: REQUEST_ID,
        expectedDraftRevision: current.draftRevision,
        sessionToken: session.sessionToken,
        updatedAt: 3,
        reviewPreparedSnapshot: { gas: "0x5208" },
      }),
    ).toMatchObject({
      status: "ready",
    });

    expect(service.approvePendingProposal(REQUEST_ID)).toMatchObject({
      status: "failed",
      reason: "prepare_not_ready",
      data: {
        transactionId: REQUEST_ID,
        prepareState: "stale_review",
      },
    });
    expect(proposalStore.get(REQUEST_ID)?.status).toBe("pending");
  });

  it("fails when review is blocked, failed, or ready without execution prepared params", () => {
    const blocked = createApprovalService();
    createTransactionProposal(blocked.proposalStore, blocked.reviewStore, { id: "tx-blocked", status: "pending" });
    const blockedProposal = blocked.proposalStore.peek("tx-blocked");
    if (!blockedProposal) throw new Error("Proposal not found");
    const blockedSession = blocked.reviewStore.getOrStartPrepare({
      id: "tx-blocked",
      draftRevision: blockedProposal.draftRevision,
      updatedAt: 1,
    });
    blocked.reviewStore.settlePrepareBlocked({
      id: "tx-blocked",
      expectedDraftRevision: blockedProposal.draftRevision,
      sessionToken: blockedSession.sessionToken,
      updatedAt: 1,
      blocker: {
        reason: "transaction.prepare.insufficient_funds",
        message: "Insufficient funds.",
      },
      reviewPreparedSnapshot: { gas: "0x5208" },
    });

    expect(blocked.service.approvePendingProposal("tx-blocked")).toMatchObject({
      status: "failed",
      reason: "prepare_blocked",
    });

    const failed = createApprovalService();
    createTransactionProposal(failed.proposalStore, failed.reviewStore, { id: "tx-failed", status: "pending" });
    const failedProposal = failed.proposalStore.peek("tx-failed");
    if (!failedProposal) throw new Error("Proposal not found");
    const failedSession = failed.reviewStore.getOrStartPrepare({
      id: "tx-failed",
      draftRevision: failedProposal.draftRevision,
      updatedAt: 1,
    });
    failed.reviewStore.settlePrepareFailed({
      id: "tx-failed",
      expectedDraftRevision: failedProposal.draftRevision,
      sessionToken: failedSession.sessionToken,
      updatedAt: 1,
      error: {
        reason: "transaction.prepare_failed",
        message: "RPC unavailable",
      },
      reviewPreparedSnapshot: null,
    });

    expect(failed.service.approvePendingProposal("tx-failed")).toMatchObject({
      status: "failed",
      reason: "prepare_failed",
    });

    const readyWithoutPrepared = createApprovalService();
    createTransactionProposal(readyWithoutPrepared.proposalStore, readyWithoutPrepared.reviewStore, {
      id: "tx-ready-without-prepared",
      status: "pending",
    });
    const readyProposal = readyWithoutPrepared.proposalStore.peek("tx-ready-without-prepared");
    if (!readyProposal) throw new Error("Proposal not found");
    const readySession = readyWithoutPrepared.reviewStore.getOrStartPrepare({
      id: "tx-ready-without-prepared",
      draftRevision: readyProposal.draftRevision,
      updatedAt: 1,
    });
    readyWithoutPrepared.reviewStore.settlePrepareReady({
      id: "tx-ready-without-prepared",
      expectedDraftRevision: readyProposal.draftRevision,
      sessionToken: readySession.sessionToken,
      updatedAt: 1,
      reviewPreparedSnapshot: { gas: "0x5208" },
    });

    expect(readyWithoutPrepared.service.approvePendingProposal("tx-ready-without-prepared")).toMatchObject({
      status: "failed",
      reason: "prepare_failed",
      message: "Transaction prepared snapshot is missing.",
      data: {
        transactionId: "tx-ready-without-prepared",
        prepareState: "ready_without_prepared",
      },
    });
  });

  it("fails with not_found and not_pending using stable payloads", () => {
    const missing = createApprovalService();
    expect(missing.service.approvePendingProposal("missing")).toMatchObject({
      status: "failed",
      reason: "not_found",
      data: { transactionId: "missing" },
    });

    const approved = createApprovalService();
    createTransactionProposal(approved.proposalStore, approved.reviewStore, {
      id: "tx-approved",
      status: "approved",
      request: {
        namespace: "eip155",
        chainRef: DEFAULT_CHAIN_REF,
        payload: {
          from: DEFAULT_FROM,
          to: DEFAULT_TO,
          value: "0x0",
          data: "0x",
        },
      },
      origin: REQUEST_CONTEXT.origin,
    });

    expect(approved.service.approvePendingProposal("tx-approved")).toMatchObject({
      status: "failed",
      reason: "not_pending",
      data: {
        transactionId: "tx-approved",
        phase: "approved",
      },
    });
  });
});
