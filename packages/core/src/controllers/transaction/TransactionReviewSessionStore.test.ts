import { describe, expect, it } from "vitest";
import { TransactionReviewSessionStore } from "./TransactionReviewSessionStore.js";

describe("TransactionReviewSessionStore", () => {
  it("starts a preparing session and returns detached snapshots", () => {
    const store = new TransactionReviewSessionStore();

    const started = store.beginPrepareSession({
      id: "tx-1",
      draftRevision: 2,
      updatedAt: 10,
    });

    expect(started).toMatchObject({
      sessionToken: expect.any(String),
      status: "preparing",
      updatedAt: 10,
      reviewPreparedSnapshot: null,
      blocker: null,
      error: null,
    });

    const current = store.get("tx-1");
    expect(current).toEqual(started);
    expect(current).not.toBe(started);
  });

  it("reuses an active session for the same draft revision", () => {
    const store = new TransactionReviewSessionStore();

    const started = store.beginPrepareSession({
      id: "tx-reuse",
      draftRevision: 2,
      updatedAt: 10,
    });

    const reused = store.reuseOrBeginPrepareSession({
      id: "tx-reuse",
      draftRevision: 2,
      updatedAt: 20,
    });

    expect(reused).toEqual(started);
    expect(reused.sessionToken).toBe(started.sessionToken);
    expect(reused.updatedAt).toBe(10);
  });

  it("restarts the session when the draft revision changes", () => {
    const store = new TransactionReviewSessionStore();

    const started = store.beginPrepareSession({
      id: "tx-restart",
      draftRevision: 1,
      updatedAt: 10,
    });

    const restarted = store.reuseOrBeginPrepareSession({
      id: "tx-restart",
      draftRevision: 2,
      updatedAt: 20,
    });

    expect(restarted.sessionToken).not.toBe(started.sessionToken);
    expect(restarted).toMatchObject({
      status: "preparing",
      updatedAt: 20,
      reviewPreparedSnapshot: null,
    });
  });

  it("rejects stale writes when the draft revision or session token no longer matches", () => {
    const store = new TransactionReviewSessionStore();

    const started = store.beginPrepareSession({
      id: "tx-2",
      draftRevision: 0,
      updatedAt: 1,
    });

    expect(
      store.markReviewBlocked({
        id: "tx-2",
        expectedDraftRevision: 0,
        sessionToken: started.sessionToken,
        updatedAt: 2,
        blocker: {
          reason: "transaction.prepare.insufficient_funds",
          message: "Insufficient funds for transaction.",
        },
        reviewPreparedSnapshot: { gas: "0x5208" },
      }),
    ).toMatchObject({
      status: "blocked",
      reviewPreparedSnapshot: { gas: "0x5208" },
    });

    expect(
      store.markReviewReady({
        id: "tx-2",
        expectedDraftRevision: 1,
        sessionToken: started.sessionToken,
        updatedAt: 3,
        reviewPreparedSnapshot: { gas: "0x5300" },
      }),
    ).toBeNull();

    expect(
      store.markReviewReady({
        id: "tx-2",
        expectedDraftRevision: 0,
        sessionToken: "wrong-session-token",
        updatedAt: 4,
        reviewPreparedSnapshot: { gas: "0x5300" },
      }),
    ).toBeNull();

    expect(store.get("tx-2")).toMatchObject({
      status: "blocked",
      reviewPreparedSnapshot: { gas: "0x5208" },
    });
  });

  it("invalidates the active session from approval finish and drops later writes", () => {
    const store = new TransactionReviewSessionStore();

    const started = store.beginPrepareSession({
      id: "tx-3",
      draftRevision: 1,
      updatedAt: 5,
    });

    expect(
      store.invalidateReviewFromApproval(
        {
          approvalId: "approval-1",
          status: "cancelled",
          terminalReason: "locked",
          subject: { kind: "transaction", transactionId: "tx-3" },
        },
        6,
      ),
    ).toMatchObject({
      status: "invalidated",
      error: {
        reason: "approval.locked",
        message: "Approval is no longer active.",
      },
      invalidatedBy: "locked",
    });

    expect(
      store.markReviewFailed({
        id: "tx-3",
        expectedDraftRevision: 1,
        sessionToken: started.sessionToken,
        updatedAt: 7,
        error: {
          reason: "transaction.prepare_failed",
          message: "should be dropped",
        },
        reviewPreparedSnapshot: null,
      }),
    ).toBeNull();
  });

  it("clears stored sessions", () => {
    const store = new TransactionReviewSessionStore();

    store.beginPrepareSession({
      id: "tx-4",
      draftRevision: 0,
      updatedAt: 1,
    });

    expect(store.clear("tx-4")).toBe(true);
    expect(store.get("tx-4")).toBeNull();
    expect(store.clear("tx-4")).toBe(false);
  });
});
