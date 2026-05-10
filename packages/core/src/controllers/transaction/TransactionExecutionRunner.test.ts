import { describe, expect, it, vi } from "vitest";
import { Messenger } from "../../messenger/Messenger.js";
import {
  createNamespacesStub,
  createNamespaceTransactionStub,
  createProposalStore,
  createReviewStore,
  createTransactionProposal,
  DEFAULT_SUBMITTED,
  REQUEST_ID,
} from "./__fixtures__/transactionServices.js";
import { TransactionExecutionRunner } from "./TransactionExecutionRunner.js";
import { TRANSACTION_BROADCAST_STARTED, TRANSACTION_SUBMITTED, TRANSACTION_TOPICS } from "./topics.js";

describe("TransactionExecutionRunner", () => {
  it("publishes broadcast/submitted events and persists the durable record after broadcast acceptance", async () => {
    const messenger = new Messenger().scope({ publish: TRANSACTION_TOPICS });
    const proposalStore = createProposalStore();
    const reviewStore = createReviewStore();
    createTransactionProposal(proposalStore, reviewStore, {
      status: "approved",
      prepared: { gas: "0x5208" },
    });

    const recordBroadcastAccepted = vi.fn();
    const persistBroadcastRecord = vi.fn(async () => {});
    const events: string[] = [];
    messenger.subscribe(TRANSACTION_BROADCAST_STARTED, () => {
      events.push("broadcast_started");
    });
    messenger.subscribe(TRANSACTION_SUBMITTED, () => {
      events.push("submitted_event");
    });

    const runner = new TransactionExecutionRunner({
      messenger,
      proposalStore,
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          sign: vi.fn(async () => ({ raw: "0x1111" })) as never,
          broadcast: vi.fn(async () => ({ submitted: DEFAULT_SUBMITTED })) as never,
        }),
      ) as never,
      submission: {
        recordBroadcastAccepted,
      },
      records: {
        persistBroadcastRecord,
      },
    });

    await runner.executeApprovedTransaction(REQUEST_ID);

    expect(events).toEqual(["broadcast_started", "submitted_event"]);
    expect(recordBroadcastAccepted).toHaveBeenCalledWith(REQUEST_ID, {
      submitted: DEFAULT_SUBMITTED,
    });
    expect(persistBroadcastRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: REQUEST_ID,
      }),
      DEFAULT_SUBMITTED,
    );
  });
});
