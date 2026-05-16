import { describe, expect, it, vi } from "vitest";
import {
  createNamespacesStub,
  createPrepareStub,
  createProposalStore,
  createTransactionProposal,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  DEFAULT_TO,
  REQUEST_ID,
} from "./__fixtures__/transactionServices.js";
import { TransactionProposalDraftService } from "./TransactionProposalDraftService.js";

describe("TransactionProposalDraftService", () => {
  it("applies a draft edit and queues prepare again", async () => {
    const proposalStore = createProposalStore();
    const rerun = vi.fn(() => {
      const proposal = proposalStore.peek(REQUEST_ID);
      if (!proposal) {
        throw new Error("Proposal missing");
      }
      proposalStore.restartPrepare({
        id: REQUEST_ID,
        draftRevision: proposal.draftRevision,
        updatedAt: 1,
      });
    });
    const service = new TransactionProposalDraftService({
      proposalStore,
      namespaces: createNamespacesStub(
        () =>
          ({
            proposal: {
              prepare: vi.fn(async () => ({ status: "ready", prepared: {} })),
              applyDraftEdit: ({ request }) => ({
                ...request,
                payload: {
                  ...request.payload,
                  to: "0xcccccccccccccccccccccccccccccccccccccccc",
                },
              }),
            },
          }) as never,
      ),
      prepare: createPrepareStub({ rerun }),
      now: () => 1,
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
    });

    await service.applyDraftEdit({
      transactionId: REQUEST_ID,
      edit: {
        namespace: "eip155",
        changes: [{ field: "gas", value: "0x5300" }],
      },
    });

    expect(rerun).toHaveBeenCalledWith(REQUEST_ID);
    expect(proposalStore.get(REQUEST_ID)?.request?.payload).toMatchObject({
      to: "0xcccccccccccccccccccccccccccccccccccccccc",
    });
    expect(proposalStore.getReviewState(REQUEST_ID)).toMatchObject({
      status: "preparing",
      updatedAt: 1,
    });
    expect(proposalStore.get(REQUEST_ID)?.prepared).toBeNull();
  });
});
