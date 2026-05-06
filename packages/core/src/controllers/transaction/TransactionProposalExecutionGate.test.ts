import { describe, expect, it } from "vitest";
import {
  createProposalStore,
  createTransactionProposal,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  DEFAULT_TO,
  markReviewReady,
  REQUEST_ID,
} from "./__fixtures__/transactionServices.js";
import { createTransactionProposalExecutionGate } from "./TransactionProposalExecutionGate.js";

const createExecutionGate = (params?: { proposalStore?: ReturnType<typeof createProposalStore> }) => {
  const proposalStore = params?.proposalStore ?? createProposalStore();
  const executionGate = createTransactionProposalExecutionGate({
    proposalStore,
    now: () => 1,
  });

  return {
    executionGate,
    proposalStore,
  };
};

describe("TransactionProposalExecutionGate", () => {
  it("approves only ready prepared proposals for execution", () => {
    const { executionGate, proposalStore } = createExecutionGate();
    createTransactionProposal(proposalStore, {
      status: "pending",
    });
    markReviewReady(proposalStore, REQUEST_ID, {
      reviewPreparedSnapshot: { gas: "0x5208" },
    });

    expect(executionGate.approveForExecution(REQUEST_ID)).toMatchObject({
      status: "approved",
      transactionId: REQUEST_ID,
    });
  });

  it("rejects execution approval when the review state is missing", () => {
    const { executionGate, proposalStore } = createExecutionGate();
    createTransactionProposal(proposalStore, {
      status: "pending",
    });

    expect(executionGate.approveForExecution(REQUEST_ID)).toMatchObject({
      status: "failed",
      reason: "prepare_not_ready",
      data: {
        transactionId: REQUEST_ID,
        prepareState: "missing_review",
      },
    });
  });

  it("rejects execution approval when prepared params do not belong to the current draft", () => {
    const { executionGate, proposalStore } = createExecutionGate();
    createTransactionProposal(proposalStore, {
      status: "pending",
    });
    const session = proposalStore.getOrStartPrepare({ id: REQUEST_ID, updatedAt: 1 });
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
    proposalStore.settlePrepareReady({
      id: REQUEST_ID,
      expectedDraftRevision: 0,
      sessionToken: session?.sessionToken ?? "",
      updatedAt: 3,
      executionPrepared: { gas: "0x5208" },
      reviewPreparedSnapshot: { gas: "0x5208" },
    });

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
    const { executionGate, proposalStore } = createExecutionGate();
    createTransactionProposal(proposalStore, {
      prepared: null,
      status: "pending",
    });
    proposalStore.getOrStartPrepare({ id: REQUEST_ID, updatedAt: 1 });

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
