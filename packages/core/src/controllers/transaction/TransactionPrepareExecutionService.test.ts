import { describe, expect, it, vi } from "vitest";
import {
  createNamespacesStub,
  createNamespaceTransactionStub,
  createProposalStore,
  createTransactionProposal,
  REQUEST_ID,
} from "./__fixtures__/transactionServices.js";
import { TransactionPrepareExecutionService } from "./TransactionPrepareExecutionService.js";

describe("TransactionPrepareExecutionService", () => {
  it("writes ready prepare results back into review and proposal state", async () => {
    const proposalStore = createProposalStore();
    createTransactionProposal(proposalStore, proposalStore, {
      status: "pending",
    });

    const service = new TransactionPrepareExecutionService({
      proposalStore,
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          prepare: vi.fn(async () => ({
            status: "ready",
            prepared: { gas: "0x5208" },
          })) as never,
        }),
      ) as never,
      now: () => 1,
    });

    await service.prepareCurrentDraft(REQUEST_ID);

    expect(proposalStore.getReviewState(REQUEST_ID)).toMatchObject({
      status: "ready",
      reviewPreparedSnapshot: { gas: "0x5208" },
    });
    expect(proposalStore.getPreparedForExecution(REQUEST_ID)).toEqual({
      gas: "0x5208",
    });
  });

  it("records failed prepare outcomes without leaving prepared execution params behind", async () => {
    const proposalStore = createProposalStore();
    createTransactionProposal(proposalStore, proposalStore, {
      status: "pending",
    });

    const service = new TransactionPrepareExecutionService({
      proposalStore,
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          prepare: vi.fn(async () => ({
            status: "failed",
            error: {
              reason: "transaction.prepare_failed",
              message: "RPC unavailable",
            },
            prepared: null,
          })) as never,
        }),
      ) as never,
      now: () => 1,
    });

    await service.prepareCurrentDraft(REQUEST_ID);

    expect(proposalStore.getReviewState(REQUEST_ID)).toMatchObject({
      status: "failed",
      error: {
        message: "RPC unavailable",
      },
    });
    expect(proposalStore.getPreparedForExecution(REQUEST_ID)).toBeNull();
  });
});
