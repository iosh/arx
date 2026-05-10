import { describe, expect, it } from "vitest";
import { TransactionReviewSessionStore } from "./TransactionReviewSessionStore.js";

describe("TransactionReviewSessionStore", () => {
  it("starts and restarts prepare sessions for a draft revision", () => {
    const store = new TransactionReviewSessionStore();

    const preparing = store.getOrStartPrepare({
      id: "tx-1",
      draftRevision: 0,
      updatedAt: 1,
    });
    expect(preparing).toMatchObject({
      status: "preparing",
      updatedAt: 1,
    });

    const restarted = store.restartPrepare({
      id: "tx-1",
      draftRevision: 0,
      updatedAt: 2,
    });
    expect(restarted).toMatchObject({
      status: "preparing",
      updatedAt: 2,
    });
    expect(restarted.sessionToken).not.toBe(preparing.sessionToken);
  });

  it("settles blocked and ready reviews for the active session", () => {
    const store = new TransactionReviewSessionStore();
    const preparing = store.getOrStartPrepare({
      id: "tx-2",
      draftRevision: 0,
      updatedAt: 1,
    });

    expect(
      store.settlePrepareBlocked({
        id: "tx-2",
        expectedDraftRevision: 0,
        sessionToken: preparing.sessionToken,
        updatedAt: 2,
        blocker: {
          reason: "transaction.prepare.insufficient_funds",
          message: "Insufficient funds.",
        },
        reviewPreparedSnapshot: { gas: "0x5208" },
      }),
    ).toMatchObject({
      status: "blocked",
      blocker: {
        reason: "transaction.prepare.insufficient_funds",
      },
      reviewPreparedSnapshot: { gas: "0x5208" },
    });

    const restarted = store.restartPrepare({
      id: "tx-2",
      draftRevision: 0,
      updatedAt: 3,
    });
    expect(
      store.settlePrepareReady({
        id: "tx-2",
        expectedDraftRevision: 0,
        sessionToken: restarted.sessionToken,
        updatedAt: 4,
        reviewPreparedSnapshot: { gas: "0x5300" },
      }),
    ).toMatchObject({
      status: "ready",
      reviewPreparedSnapshot: { gas: "0x5300" },
    });
  });

  it("drops stale settlements and invalidates active reviews from approval terminal events", () => {
    const store = new TransactionReviewSessionStore();
    const initial = store.getOrStartPrepare({
      id: "tx-3",
      draftRevision: 0,
      updatedAt: 1,
    });

    expect(
      store.settlePrepareReady({
        id: "tx-3",
        expectedDraftRevision: 1,
        sessionToken: initial.sessionToken,
        updatedAt: 2,
        reviewPreparedSnapshot: { gas: "0x5208" },
      }),
    ).toBeNull();

    const current = store.getOrStartPrepare({
      id: "tx-3",
      draftRevision: 1,
      updatedAt: 3,
    });
    expect(
      store.invalidatePrepareFromApproval(
        {
          approvalId: "approval-3",
          status: "cancelled",
          terminalReason: "locked",
          subject: { kind: "transaction", transactionId: "tx-3" },
        },
        4,
      ),
    ).toMatchObject({
      status: "invalidated",
      invalidatedBy: "locked",
      error: {
        reason: "approval.locked",
      },
    });

    expect(
      store.settlePrepareFailed({
        id: "tx-3",
        expectedDraftRevision: 1,
        sessionToken: current.sessionToken,
        updatedAt: 5,
        error: {
          reason: "transaction.prepare_failed",
          message: "stale",
        },
        reviewPreparedSnapshot: null,
      }),
    ).toBeNull();

    expect(
      store.invalidatePrepareFromApproval(
        {
          approvalId: "approval-3",
          status: "approved",
          terminalReason: "user_approve",
          subject: { kind: "transaction", transactionId: "tx-3" },
        },
        6,
      ),
    ).toBeNull();
  });
});
