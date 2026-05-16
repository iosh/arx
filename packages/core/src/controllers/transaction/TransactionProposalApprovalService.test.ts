import { describe, expect, it } from "vitest";
import {
  createProposalStore,
  createTransactionProposal,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  DEFAULT_TO,
  REQUEST_CONTEXT,
  REQUEST_ID,
} from "./__fixtures__/transactionServices.js";
import { TransactionProposalApprovalService } from "./TransactionProposalApprovalService.js";

const createApprovalService = (params?: { proposalStore?: ReturnType<typeof createProposalStore> }) => {
  const proposalStore = params?.proposalStore ?? createProposalStore();

  return {
    proposalStore,
    service: new TransactionProposalApprovalService({
      proposalStore,
      now: () => 1,
    }),
  };
};

describe("TransactionProposalApprovalService", () => {
  it("approves only ready proposals with current prepared params", () => {
    const { service, proposalStore } = createApprovalService();

    createTransactionProposal(proposalStore, {
      status: "pending",
    });
    const current = proposalStore.peek(REQUEST_ID);
    if (!current) {
      throw new Error("Proposal not found");
    }

    const session = proposalStore.getOrStartPrepare({
      id: REQUEST_ID,
      draftRevision: current.draftRevision,
      updatedAt: 1,
    });
    if (!session) {
      throw new Error("Prepare session not started");
    }
    proposalStore.settlePrepareReady({
      id: REQUEST_ID,
      expectedDraftRevision: current.draftRevision,
      sessionToken: session.sessionToken,
      updatedAt: 1,
      executionPrepared: { gas: "0x5208" },
      reviewPreparedSnapshot: { gas: "0x5208" },
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

  it("fails while prepare is still in progress", () => {
    const { service, proposalStore } = createApprovalService();
    createTransactionProposal(proposalStore, { status: "pending" });

    expect(service.approvePendingProposal(REQUEST_ID)).toMatchObject({
      status: "failed",
      reason: "prepare_not_ready",
      data: {
        transactionId: REQUEST_ID,
        prepareState: "preparing",
      },
    });
  });

  it("fails when the current draft revision no longer matches the review", () => {
    const { service, proposalStore } = createApprovalService();
    createTransactionProposal(proposalStore, { status: "pending" });

    const current = proposalStore.peek(REQUEST_ID);
    if (!current) {
      throw new Error("Proposal not found");
    }
    const session = proposalStore.getOrStartPrepare({
      id: REQUEST_ID,
      draftRevision: current.draftRevision,
      updatedAt: 1,
    });
    if (!session) {
      throw new Error("Prepare session not started");
    }
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
      proposalStore.settlePrepareReady({
        id: REQUEST_ID,
        expectedDraftRevision: current.draftRevision,
        sessionToken: session.sessionToken,
        updatedAt: 3,
        executionPrepared: { gas: "0x5208" },
        reviewPreparedSnapshot: { gas: "0x5208" },
      }),
    ).toBeNull();

    expect(service.approvePendingProposal(REQUEST_ID)).toMatchObject({
      status: "failed",
      reason: "prepare_not_ready",
      data: {
        transactionId: REQUEST_ID,
        prepareState: "preparing",
      },
    });
    expect(proposalStore.get(REQUEST_ID)?.status).toBe("pending");
  });

  it("fails when review is blocked or failed", () => {
    const blocked = createApprovalService();
    createTransactionProposal(blocked.proposalStore, { id: "tx-blocked", status: "pending" });
    const blockedProposal = blocked.proposalStore.peek("tx-blocked");
    if (!blockedProposal) throw new Error("Proposal not found");
    const blockedSession = blocked.proposalStore.getOrStartPrepare({
      id: "tx-blocked",
      draftRevision: blockedProposal.draftRevision,
      updatedAt: 1,
    });
    if (!blockedSession) {
      throw new Error("Prepare session not started");
    }
    blocked.proposalStore.settlePrepareBlocked({
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
    createTransactionProposal(failed.proposalStore, { id: "tx-failed", status: "pending" });
    const failedProposal = failed.proposalStore.peek("tx-failed");
    if (!failedProposal) throw new Error("Proposal not found");
    const failedSession = failed.proposalStore.getOrStartPrepare({
      id: "tx-failed",
      draftRevision: failedProposal.draftRevision,
      updatedAt: 1,
    });
    if (!failedSession) {
      throw new Error("Prepare session not started");
    }
    failed.proposalStore.settlePrepareFailed({
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
  });

  it("fails with not_found and not_pending using stable payloads", () => {
    const missing = createApprovalService();
    expect(missing.service.approvePendingProposal("missing")).toMatchObject({
      status: "failed",
      reason: "not_found",
      data: { transactionId: "missing" },
    });

    const approved = createApprovalService();
    createTransactionProposal(approved.proposalStore, {
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
