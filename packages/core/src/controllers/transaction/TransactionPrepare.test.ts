import { describe, expect, it, vi } from "vitest";
import {
  createNamespacesStub,
  createNamespaceTransactionStub,
  createProposalRuntime,
  createTransactionProposal,
  REQUEST_ID,
} from "./__fixtures__/transactionServices.js";
import { TransactionPrepare } from "./TransactionPrepare.js";

describe("TransactionPrepare", () => {
  it("deduplicates concurrent prepare requests for the same draft revision", async () => {
    const proposalRuntime = createProposalRuntime();
    createTransactionProposal(proposalRuntime, {
      status: "pending",
    });

    let release: (() => void) | null = null;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prepare = new TransactionPrepare({
      proposalRuntime,
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          prepare: vi.fn(async () => {
            await blocked;
            return {
              status: "ready",
              prepared: { gas: "0x5208" },
            };
          }) as never,
        }),
      ) as never,
      now: () => 1,
    });

    const prepareSpy = vi.spyOn(prepare, "prepareCurrentDraft");

    prepare.queue(REQUEST_ID);
    prepare.queue(REQUEST_ID);
    await vi.waitFor(() => expect(prepareSpy).toHaveBeenCalledTimes(1));
    release?.();
    await vi.waitFor(() => expect(proposalRuntime.getPreparedForExecution(REQUEST_ID)).toEqual({ gas: "0x5208" }));
  });

  it("reruns prepare when the draft revision changes while a prepare was in flight", async () => {
    const proposalRuntime = createProposalRuntime();
    createTransactionProposal(proposalRuntime, {
      status: "pending",
    });

    let run = 0;
    const prepare = new TransactionPrepare({
      proposalRuntime,
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          prepare: vi.fn(async () => {
            run += 1;
            const current = proposalRuntime.peek(REQUEST_ID);
            if (!current) {
              throw new Error("Proposal missing");
            }

            if (run === 1) {
              expect(
                proposalRuntime.replacePendingDraftRequest({
                  id: REQUEST_ID,
                  request: {
                    namespace: "eip155",
                    chainRef: "eip155:10",
                    payload: {
                      to: "0xcccccccccccccccccccccccccccccccccccccccc",
                    },
                  },
                  updatedAt: 2,
                }),
              ).toMatchObject({
                status: "updated",
              });
            }

            return {
              status: "ready" as const,
              prepared: { gas: run === 1 ? "0x5208" : "0x5300" },
            };
          }) as never,
        }),
      ) as never,
      now: () => 1,
    });

    const prepareSpy = vi.spyOn(prepare, "prepareCurrentDraft");

    prepare.queue(REQUEST_ID);
    await vi.waitFor(() => expect(prepareSpy).toHaveBeenCalledTimes(2));
    expect(proposalRuntime.getPreparedForExecution(REQUEST_ID)).toEqual({
      gas: "0x5300",
    });
  });

  it("restarts the review session before rerunning prepare", async () => {
    const proposalRuntime = createProposalRuntime();
    createTransactionProposal(proposalRuntime, {
      status: "pending",
    });

    const initial = proposalRuntime.getOrStartPrepare({
      id: REQUEST_ID,
      draftRevision: 0,
      updatedAt: 1,
    });
    const prepare = new TransactionPrepare({
      proposalRuntime,
      namespaces: createNamespacesStub(),
      now: () => 2,
    });

    prepare.rerun(REQUEST_ID);

    expect(proposalRuntime.getReviewState(REQUEST_ID)).toMatchObject({
      status: "preparing",
      updatedAt: 2,
    });
    expect(proposalRuntime.getReviewState(REQUEST_ID)?.sessionToken).not.toBe(initial?.sessionToken);
  });

  it("writes ready prepare results back into review and proposal state", async () => {
    const proposalRuntime = createProposalRuntime();
    createTransactionProposal(proposalRuntime, {
      status: "pending",
    });

    const prepare = new TransactionPrepare({
      proposalRuntime,
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

    await prepare.prepareCurrentDraft(REQUEST_ID);

    expect(proposalRuntime.getReviewState(REQUEST_ID)).toMatchObject({
      status: "ready",
      reviewPreparedSnapshot: { gas: "0x5208" },
    });
    expect(proposalRuntime.getPreparedForExecution(REQUEST_ID)).toEqual({
      gas: "0x5208",
    });
  });

  it("records failed prepare outcomes without leaving prepared execution params behind", async () => {
    const proposalRuntime = createProposalRuntime();
    createTransactionProposal(proposalRuntime, {
      status: "pending",
    });

    const prepare = new TransactionPrepare({
      proposalRuntime,
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

    await prepare.prepareCurrentDraft(REQUEST_ID);

    expect(proposalRuntime.getReviewState(REQUEST_ID)).toMatchObject({
      status: "failed",
      error: {
        message: "RPC unavailable",
      },
    });
    expect(proposalRuntime.getPreparedForExecution(REQUEST_ID)).toBeNull();
  });
});
