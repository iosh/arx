import { describe, expect, it } from "vitest";
import {
  createProposalStore,
  createReviewSessionStore,
  createTransactionProposal,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  DEFAULT_TO,
  markReviewReady,
  REQUEST_ID,
} from "./__fixtures__/transactionServices.js";
import { createTransactionProposalExecutionGate } from "./TransactionProposalExecutionGate.js";

const createExecutionGate = (params?: {
  proposalStore?: ReturnType<typeof createProposalStore>;
  reviewStore?: ReturnType<typeof createReviewSessionStore>;
}) => {
  const proposalStore = params?.proposalStore ?? createProposalStore();
  const reviewStore = params?.reviewStore ?? createReviewSessionStore();
  const executionGate = createTransactionProposalExecutionGate({
    proposalStore,
    reviewSessions: reviewStore,
    readTransactionTimestamp: () => 1,
  });

  return {
    executionGate,
    proposalStore,
    reviewStore,
  };
};

describe("TransactionProposalExecutionGate", () => {
  it("approves only ready prepared proposals for execution", () => {
    const { executionGate, proposalStore, reviewStore } = createExecutionGate();
    createTransactionProposal(proposalStore, {
      status: "pending",
    });
    proposalStore.commitPrepared(REQUEST_ID, 0, { gas: "0x5208" });
    markReviewReady(proposalStore, reviewStore, REQUEST_ID);

    expect(executionGate.approveForExecution(REQUEST_ID)).toMatchObject({
      status: "approved",
      transactionId: REQUEST_ID,
    });
  });

  it("rejects execution approval when the review session is missing even if prepared params exist", () => {
    const { executionGate, proposalStore } = createExecutionGate();
    createTransactionProposal(proposalStore, {
      status: "pending",
    });
    proposalStore.commitPrepared(REQUEST_ID, 0, { gas: "0x5208" });

    expect(executionGate.approveForExecution(REQUEST_ID)).toMatchObject({
      status: "failed",
      reason: "prepare_not_ready",
      data: {
        transactionId: REQUEST_ID,
        prepareState: "missing_review_session",
      },
    });
  });

  it("rejects execution approval when prepared params do not belong to the current draft", () => {
    const { executionGate, proposalStore, reviewStore } = createExecutionGate();
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

    expect(executionGate.approveForExecution(REQUEST_ID)).toMatchObject({
      status: "failed",
      reason: "prepare_not_ready",
      data: {
        transactionId: REQUEST_ID,
      },
    });
    expect(proposalStore.get(REQUEST_ID)?.status).toBe("pending");
  });

  it("blocks execution approval when review is not ready", () => {
    const { executionGate, proposalStore, reviewStore } = createExecutionGate();
    createTransactionProposal(proposalStore, {
      prepared: null,
      status: "pending",
    });
    reviewStore.beginPrepareSession({ id: REQUEST_ID, draftRevision: 0, updatedAt: 1 });

    expect(executionGate.approveForExecution(REQUEST_ID)).toMatchObject({
      status: "failed",
      reason: "prepare_not_ready",
      data: {
        transactionId: REQUEST_ID,
        prepareState: "preparing",
      },
    });
    expect(proposalStore.get(REQUEST_ID)?.status).toBe("pending");
  });
});
