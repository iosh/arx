import { describe, expect, it, vi } from "vitest";
import { Messenger } from "../../messenger/Messenger.js";
import {
  APPROVAL_ID,
  accountCodecs,
  createProposalStores,
  createTransactionProposal,
  REQUEST_ID,
} from "./__fixtures__/transactionServices.js";
import { createApprovalDetailInvalidations } from "./createApprovalDetailInvalidations.js";
import { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";
import { TRANSACTION_TOPICS } from "./topics.js";

const createRecordViewStore = () =>
  new TransactionRecordViewStore({
    messenger: new Messenger().scope({ publish: TRANSACTION_TOPICS }),
    service: {
      get: vi.fn(async () => null),
      list: vi.fn(async () => []),
      findByReplacementIdentity: vi.fn(async () => []),
      createBroadcastRecord: vi.fn(async () => {
        throw new Error("not implemented");
      }),
      updateRecordStatus: vi.fn(async () => null),
      subscribeChanged: vi.fn(() => () => {}),
      linkRecord: vi.fn(async () => null),
      remove: vi.fn(async () => {}),
    },
    accountCodecs,
    stateLimit: 10,
  });

describe("createApprovalDetailInvalidations", () => {
  it("invalidates review state and clears prepared execution params when a transaction approval finishes terminally", async () => {
    const messenger = new Messenger();
    const { proposalStore, reviewStore } = createProposalStores();
    const recordView = createRecordViewStore();
    const onFinished = vi.fn<(event: unknown) => void>();

    createTransactionProposal(proposalStore, reviewStore, {
      status: "pending",
      prepared: { gas: "0x5208" },
    });
    const review = reviewStore.getOrStartPrepare({
      id: REQUEST_ID,
      draftRevision: 0,
      updatedAt: 1,
    });
    reviewStore.settlePrepareReady({
      id: REQUEST_ID,
      expectedDraftRevision: 0,
      sessionToken: review.sessionToken,
      updatedAt: 2,
      reviewPreparedSnapshot: { gas: "0x5208" },
    });

    createApprovalDetailInvalidations({
      messenger: messenger.scope({ publish: TRANSACTION_TOPICS }),
      approvals: {
        onFinished: (handler) => {
          onFinished.mockImplementation(handler as never);
          return () => {};
        },
        listPendingIdsBySubject: vi.fn(() => [APPROVAL_ID]),
      },
      proposalStore,
      reviewStore,
      recordView,
      now: () => 3,
    });

    onFinished({
      approvalId: APPROVAL_ID,
      status: "cancelled",
      terminalReason: "locked",
      subject: { kind: "transaction", transactionId: REQUEST_ID },
    });

    expect(reviewStore.getReviewState(REQUEST_ID)).toMatchObject({
      status: "invalidated",
      invalidatedBy: "locked",
    });
    expect(proposalStore.getPreparedForExecution(REQUEST_ID)).toBeNull();
  });

  it("publishes approval invalidations for proposal and review changes", async () => {
    const messenger = new Messenger();
    const { proposalStore, reviewStore } = createProposalStores();
    const recordView = createRecordViewStore();
    const invalidations: Array<{ approvalIds: string[] }> = [];

    createApprovalDetailInvalidations({
      messenger: messenger.scope({ publish: TRANSACTION_TOPICS }),
      approvals: {
        onFinished: () => () => {},
        listPendingIdsBySubject: vi.fn(() => [APPROVAL_ID]),
      },
      proposalStore,
      reviewStore,
      recordView,
      now: () => 1,
    }).onChanged((change) => {
      invalidations.push(change);
    });

    createTransactionProposal(proposalStore, reviewStore, {
      status: "pending",
    });

    await Promise.resolve();

    expect(invalidations).toContainEqual({
      approvalIds: [APPROVAL_ID],
    });
  });
});
