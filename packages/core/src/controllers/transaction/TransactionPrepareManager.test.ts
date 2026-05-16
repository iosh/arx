import { describe, expect, it, vi } from "vitest";
import { createProposalStore, createTransactionProposal, REQUEST_ID } from "./__fixtures__/transactionServices.js";
import { TransactionPrepareManager } from "./TransactionPrepareManager.js";

describe("TransactionPrepareManager", () => {
  it("deduplicates concurrent prepare requests for the same draft revision", async () => {
    const proposalStore = createProposalStore();
    createTransactionProposal(proposalStore, proposalStore, {
      status: "pending",
    });

    let release: (() => void) | null = null;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prepareCurrentDraft = vi.fn(async () => {
      await blocked;
      proposalStore.updatePreparedForDraft({
        id: REQUEST_ID,
        expectedDraftRevision: 0,
        updatedAt: 1,
        prepared: { gas: "0x5208" },
      });
    });

    const manager = new TransactionPrepareManager({
      proposalStore,
      execution: { prepareCurrentDraft },
      now: () => 1,
    });

    manager.queuePrepare(REQUEST_ID);
    manager.queuePrepare(REQUEST_ID);
    await vi.waitFor(() => expect(prepareCurrentDraft).toHaveBeenCalledTimes(1));
    release?.();
    await vi.waitFor(() => expect(proposalStore.getPreparedForExecution(REQUEST_ID)).toEqual({ gas: "0x5208" }));
  });

  it("reruns prepare when the draft revision changes while a prepare was in flight", async () => {
    const proposalStore = createProposalStore();
    createTransactionProposal(proposalStore, proposalStore, {
      status: "pending",
    });

    let run = 0;
    const prepareCurrentDraft = vi.fn(async () => {
      run += 1;
      const current = proposalStore.peek(REQUEST_ID);
      if (!current) {
        throw new Error("Proposal missing");
      }

      if (run === 1) {
        proposalStore.replacePendingDraftRequest({
          id: REQUEST_ID,
          request: {
            namespace: "eip155",
            chainRef: "eip155:10",
            payload: {
              to: "0xcccccccccccccccccccccccccccccccccccccccc",
            },
          },
          updatedAt: 2,
        });
      }

      proposalStore.updatePreparedForDraft({
        id: REQUEST_ID,
        expectedDraftRevision: current.draftRevision,
        updatedAt: 3 + run,
        prepared: { gas: run === 1 ? "0x5208" : "0x5300" },
      });
    });

    const manager = new TransactionPrepareManager({
      proposalStore,
      execution: { prepareCurrentDraft },
      now: () => 1,
    });

    manager.queuePrepare(REQUEST_ID);
    await vi.waitFor(() => expect(prepareCurrentDraft).toHaveBeenCalledTimes(2));
    expect(proposalStore.getPreparedForExecution(REQUEST_ID)).toEqual({
      gas: "0x5300",
    });
  });

  it("restarts the review session before rerunning prepare", async () => {
    const proposalStore = createProposalStore();
    createTransactionProposal(proposalStore, proposalStore, {
      status: "pending",
    });

    const initial = proposalStore.getOrStartPrepare({
      id: REQUEST_ID,
      draftRevision: 0,
      updatedAt: 1,
    });
    const prepareCurrentDraft = vi.fn(async () => {});

    const manager = new TransactionPrepareManager({
      proposalStore,
      execution: { prepareCurrentDraft },
      now: () => 2,
    });

    manager.rerunPrepare(REQUEST_ID);

    expect(proposalStore.getReviewState(REQUEST_ID)).toMatchObject({
      status: "preparing",
      updatedAt: 2,
    });
    expect(proposalStore.getReviewState(REQUEST_ID)?.sessionToken).not.toBe(initial?.sessionToken);
  });
});
