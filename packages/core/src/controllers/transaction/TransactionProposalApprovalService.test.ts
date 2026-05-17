import { describe, expect, it } from "vitest";
import {
  createProposalRuntime,
  createTransactionProposal,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  DEFAULT_TO,
  REQUEST_CONTEXT,
  REQUEST_ID,
} from "./__fixtures__/transactionServices.js";
import { TransactionProposalApprovalService } from "./TransactionProposalApprovalService.js";

const createApprovalService = (params?: { proposalRuntime?: ReturnType<typeof createProposalRuntime> }) => {
  const proposalRuntime = params?.proposalRuntime ?? createProposalRuntime();

  return {
    proposalRuntime,
    service: new TransactionProposalApprovalService({
      proposalRuntime,
      now: () => 1,
    }),
  };
};

describe("TransactionProposalApprovalService", () => {
  it("approves only ready proposals with current prepared params", () => {
    const { service, proposalRuntime } = createApprovalService();

    createTransactionProposal(proposalRuntime, {
      status: "pending",
    });
    const current = proposalRuntime.peek(REQUEST_ID);
    if (!current) {
      throw new Error("Proposal not found");
    }

    const session = proposalRuntime.getOrStartPrepare({
      id: REQUEST_ID,
      draftRevision: current.draftRevision,
      updatedAt: 1,
    });
    if (session.status !== "opened") {
      throw new Error("Prepare session not started");
    }
    proposalRuntime.settlePrepareReady({
      id: REQUEST_ID,
      expectedDraftRevision: current.draftRevision,
      sessionToken: session.review.sessionToken,
      updatedAt: 1,
      executionPrepared: { gas: "0x5208" },
      reviewPreparedSnapshot: { gas: "0x5208" },
    });

    expect(service.approvePendingProposal(REQUEST_ID)).toEqual({
      status: "approved",
      transactionId: REQUEST_ID,
    });
    expect(proposalRuntime.get(REQUEST_ID)).toMatchObject({
      status: "approved",
      prepared: { gas: "0x5208" },
    });
  });

  it("fails while prepare is still in progress", () => {
    const { service, proposalRuntime } = createApprovalService();
    createTransactionProposal(proposalRuntime, { status: "pending" });

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
    const { service, proposalRuntime } = createApprovalService();
    createTransactionProposal(proposalRuntime, { status: "pending" });

    const current = proposalRuntime.peek(REQUEST_ID);
    if (!current) {
      throw new Error("Proposal not found");
    }
    const session = proposalRuntime.getOrStartPrepare({
      id: REQUEST_ID,
      draftRevision: current.draftRevision,
      updatedAt: 1,
    });
    if (session.status !== "opened") {
      throw new Error("Prepare session not started");
    }
    expect(
      proposalRuntime.replacePendingDraftRequest({
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
      }),
    ).toMatchObject({
      status: "updated",
    });

    expect(
      proposalRuntime.settlePrepareReady({
        id: REQUEST_ID,
        expectedDraftRevision: current.draftRevision,
        sessionToken: session.sessionToken,
        updatedAt: 3,
        executionPrepared: { gas: "0x5208" },
        reviewPreparedSnapshot: { gas: "0x5208" },
      }),
    ).toEqual({
      status: "stale",
      draftRevision: 1,
      sessionToken: expect.any(String),
    });

    expect(service.approvePendingProposal(REQUEST_ID)).toMatchObject({
      status: "failed",
      reason: "prepare_not_ready",
      data: {
        transactionId: REQUEST_ID,
        prepareState: "preparing",
      },
    });
    expect(proposalRuntime.get(REQUEST_ID)?.status).toBe("pending");
  });

  it("fails when review is blocked or failed", () => {
    const blocked = createApprovalService();
    createTransactionProposal(blocked.proposalRuntime, { id: "tx-blocked", status: "pending" });
    const blockedProposal = blocked.proposalRuntime.peek("tx-blocked");
    if (!blockedProposal) throw new Error("Proposal not found");
    const blockedSession = blocked.proposalRuntime.getOrStartPrepare({
      id: "tx-blocked",
      draftRevision: blockedProposal.draftRevision,
      updatedAt: 1,
    });
    if (blockedSession.status !== "opened") {
      throw new Error("Prepare session not started");
    }
    blocked.proposalRuntime.settlePrepareBlocked({
      id: "tx-blocked",
      expectedDraftRevision: blockedProposal.draftRevision,
      sessionToken: blockedSession.review.sessionToken,
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
    createTransactionProposal(failed.proposalRuntime, { id: "tx-failed", status: "pending" });
    const failedProposal = failed.proposalRuntime.peek("tx-failed");
    if (!failedProposal) throw new Error("Proposal not found");
    const failedSession = failed.proposalRuntime.getOrStartPrepare({
      id: "tx-failed",
      draftRevision: failedProposal.draftRevision,
      updatedAt: 1,
    });
    if (failedSession.status !== "opened") {
      throw new Error("Prepare session not started");
    }
    failed.proposalRuntime.settlePrepareFailed({
      id: "tx-failed",
      expectedDraftRevision: failedProposal.draftRevision,
      sessionToken: failedSession.review.sessionToken,
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
    createTransactionProposal(approved.proposalRuntime, {
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
