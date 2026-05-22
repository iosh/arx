import { describe, expect, it } from "vitest";
import { Messenger } from "../../messenger/Messenger.js";
import { TRANSACTION_TOPICS } from "../topics.js";
import { TransactionProposalRuntime } from "./TransactionProposalRuntime.js";

const createStore = () =>
  new TransactionProposalRuntime({
    messenger: new Messenger().scope({ publish: TRANSACTION_TOPICS }),
    accountCodecs: {
      toCanonicalAddressFromAccountKey: () => "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  });

const accountKey = "test-account-key";

describe("TransactionProposalRuntime", () => {
  it("defensively copies created state so caller mutations do not leak into proposal state", () => {
    const store = createStore();
    const request = {
      namespace: "eip155" as const,
      chainRef: "eip155:1",
      payload: {
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        gas: "0x5208",
      },
    };
    const prepared = { fee: { maxFeePerGas: "0x1" } };
    const error = { name: "Error", message: "boom", data: { code: "E_FAIL" } };

    store.createPendingProposal({
      id: "11111111-1111-4111-8111-111111111111",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request,
      prepared,
      createdAt: 1,
      updatedAt: 1,
    });
    store.approvePendingProposal({ id: "11111111-1111-4111-8111-111111111111", updatedAt: 1 });
    request.payload.gas = "0x9999";
    prepared.fee.maxFeePerGas = "0x9";
    error.data.code = "E_CHANGED";

    const meta = store.get("11111111-1111-4111-8111-111111111111");
    expect(meta?.request?.payload).toEqual({
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      gas: "0x5208",
    });
    expect(meta?.prepared).toEqual({ fee: { maxFeePerGas: "0x1" } });
    expect(meta?.termination).toBeUndefined();
  });

  it("returns detached meta snapshots so consumer mutations do not write back", () => {
    const store = createStore();
    const created = store.createPendingProposal({
      id: "22222222-2222-4222-8222-222222222222",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: {
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          gas: "0x5208",
        },
      },
      prepared: { fee: { maxFeePerGas: "0x1" } },
      createdAt: 1,
      updatedAt: 1,
    });

    if (created.request) {
      created.request.payload.gas = "0x9999";
    }
    if (created.prepared) {
      (created.prepared as { fee: { maxFeePerGas: string } }).fee.maxFeePerGas = "0x9";
    }

    const reloaded = store.get("22222222-2222-4222-8222-222222222222");
    expect(reloaded?.request?.payload).toEqual({
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      gas: "0x5208",
    });
    expect(reloaded?.prepared).toEqual({ fee: { maxFeePerGas: "0x1" } });
    expect(reloaded?.termination).toBeUndefined();
  });

  it("replaces pending drafts by bumping revision and clearing prepared state", () => {
    const store = createStore();
    store.createPendingProposal({
      id: "33333333-3333-4333-8333-333333333333",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: { to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
      },
      prepared: { gas: "0x5208" },
      createdAt: 1,
      updatedAt: 1,
    });

    const next = store.replacePendingDraftRequest({
      id: "33333333-3333-4333-8333-333333333333",
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: { to: "0xcccccccccccccccccccccccccccccccccccccccc" },
      },
      updatedAt: 2,
    });

    expect(next).toMatchObject({
      status: "updated",
      proposal: {
        request: {
          payload: { to: "0xcccccccccccccccccccccccccccccccccccccccc" },
        },
        prepared: null,
        updatedAt: 2,
      },
    });
    expect(store.peek("33333333-3333-4333-8333-333333333333")?.prepare.requestRevision).toBe(1);
  });

  it("returns explicit replace-draft outcomes for missing and non-pending proposals", () => {
    const store = createStore();

    expect(
      store.replacePendingDraftRequest({
        id: "missing",
        request: {
          namespace: "eip155",
          chainRef: "eip155:1",
          payload: {},
        },
        updatedAt: 1,
      }),
    ).toEqual({ status: "not_found" });

    store.createPendingProposal({
      id: "approved-proposal",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: {},
      },
      createdAt: 1,
      updatedAt: 1,
    });
    store.updatePreparedForDraft({
      id: "approved-proposal",
      expectedRequestRevision: 0,
      updatedAt: 1,
      prepared: {},
    });
    const approvedReview = store.getOrStartPrepare({
      id: "approved-proposal",
      requestRevision: 0,
      updatedAt: 1,
    });
    if (approvedReview.status !== "opened") {
      throw new Error("Prepare session not started");
    }
    store.settlePrepareReady({
      id: "approved-proposal",
      expectedRequestRevision: 0,
      sessionToken: approvedReview.review.sessionToken,
      updatedAt: 1,
      executionPrepared: {},
      reviewPreparedSnapshot: {},
    });
    expect(store.approvePendingProposal({ id: "approved-proposal", updatedAt: 1 })).toMatchObject({
      status: "approved",
    });

    expect(
      store.replacePendingDraftRequest({
        id: "approved-proposal",
        request: {
          namespace: "eip155",
          chainRef: "eip155:1",
          payload: {},
        },
        updatedAt: 2,
      }),
    ).toEqual({
      status: "not_pending",
      statusValue: "approved",
    });
  });

  it("returns explicit fail outcomes for missing, inactive, and active proposals", () => {
    const store = createStore();

    expect(
      store.failProposal({
        id: "missing",
        updatedAt: 1,
        error: null,
        terminationReason: "execution_failed",
      }),
    ).toEqual({ status: "not_found" });

    store.createPendingProposal({
      id: "failed-proposal",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: {},
      },
      createdAt: 1,
      updatedAt: 1,
    });
    expect(
      store.failProposal({
        id: "failed-proposal",
        updatedAt: 2,
        error: { name: "Error", message: "boom" },
        terminationReason: "execution_failed",
      }),
    ).toMatchObject({
      status: "failed",
      proposal: {
        id: "failed-proposal",
        status: "terminated",
        termination: {
          reason: "execution_failed",
          userRejected: false,
          error: {
            name: "Error",
            message: "boom",
          },
        },
      },
    });

    expect(
      store.failProposal({
        id: "failed-proposal",
        updatedAt: 3,
        error: { name: "Error", message: "late" },
        terminationReason: "execution_failed",
      }),
    ).toEqual({
      status: "not_active",
      statusValue: "terminated",
    });
  });

  it("updates prepared params only for the matching draft revision", () => {
    const store = createStore();
    const id = "44444444-4444-4444-8444-444444444444";

    store.createPendingProposal({
      id,
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: { to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
      },
      createdAt: 1,
      updatedAt: 1,
    });

    expect(
      store.updatePreparedForDraft({
        id,
        expectedRequestRevision: 1,
        updatedAt: 2,
        prepared: { gas: "0x5208" },
      }),
    ).toEqual({
      status: "stale",
      requestRevision: 0,
    });

    expect(
      store.updatePreparedForDraft({
        id,
        expectedRequestRevision: 0,
        updatedAt: 3,
        prepared: { gas: "0x5208" },
      }),
    ).toMatchObject({
      status: "updated",
      proposal: {
        prepared: { gas: "0x5208" },
        updatedAt: 3,
      },
    });
    expect(store.getPreparedForExecution(id)).toEqual({ gas: "0x5208" });
  });

  it("approves pending proposals and lists only approved proposals as executable", () => {
    const store = createStore();

    store.createPendingProposal({
      id: "55555555-5555-4555-8555-555555555555",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: {},
      },
      createdAt: 1,
      updatedAt: 1,
    });
    store.updatePreparedForDraft({
      id: "55555555-5555-4555-8555-555555555555",
      expectedRequestRevision: 0,
      updatedAt: 1,
      prepared: {},
    });
    const readyReview = store.getOrStartPrepare({
      id: "55555555-5555-4555-8555-555555555555",
      requestRevision: 0,
      updatedAt: 1,
    });
    if (readyReview.status !== "opened") {
      throw new Error("Prepare session not started");
    }
    store.settlePrepareReady({
      id: "55555555-5555-4555-8555-555555555555",
      expectedRequestRevision: 0,
      sessionToken: readyReview.review.sessionToken,
      updatedAt: 1,
      executionPrepared: {},
      reviewPreparedSnapshot: {},
    });
    expect(store.approvePendingProposal({ id: "55555555-5555-4555-8555-555555555555", updatedAt: 1 })).toMatchObject({
      status: "approved",
      proposal: {
        status: "approved",
      },
      prepared: {},
    });

    store.createPendingProposal({
      id: "66666666-6666-4666-8666-666666666666",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: {},
      },
      createdAt: 1,
      updatedAt: 1,
    });

    expect(store.listExecutableProposalIds()).toEqual(["55555555-5555-4555-8555-555555555555"]);
  });

  it("returns explicit approve outcomes for missing, non-pending, and prepare-gate failures", () => {
    const store = createStore();

    expect(store.approvePendingProposal({ id: "missing", updatedAt: 1 })).toEqual({
      status: "not_found",
    });

    store.createPendingProposal({
      id: "preparing-proposal",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: {},
      },
      createdAt: 1,
      updatedAt: 1,
    });
    expect(store.approvePendingProposal({ id: "preparing-proposal", updatedAt: 2 })).toEqual({
      status: "prepare_not_ready",
      prepareState: "preparing",
    });

    const staleId = "stale-proposal";
    store.createPendingProposal({
      id: staleId,
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: {},
      },
      createdAt: 1,
      updatedAt: 1,
    });
    const staleSession = store.getOrStartPrepare({
      id: staleId,
      requestRevision: 0,
      updatedAt: 1,
    });
    if (staleSession.status !== "opened") {
      throw new Error("Prepare session not started");
    }
    expect(
      store.replacePendingDraftRequest({
        id: staleId,
        request: {
          namespace: "eip155",
          chainRef: "eip155:1",
          payload: { value: "0x1" },
        },
        updatedAt: 2,
      }),
    ).toMatchObject({
      status: "updated",
    });
    expect(store.approvePendingProposal({ id: staleId, updatedAt: 3 })).toEqual({
      status: "prepare_not_ready",
      prepareState: "preparing",
    });

    const blockedId = "blocked-proposal";
    store.createPendingProposal({
      id: blockedId,
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: {},
      },
      createdAt: 1,
      updatedAt: 1,
    });
    const blockedSession = store.getOrStartPrepare({
      id: blockedId,
      requestRevision: 0,
      updatedAt: 1,
    });
    if (blockedSession.status !== "opened") {
      throw new Error("Prepare session not started");
    }
    store.settlePrepareBlocked({
      id: blockedId,
      expectedRequestRevision: 0,
      sessionToken: blockedSession.review.sessionToken,
      updatedAt: 2,
      blocker: {
        reason: "transaction.prepare.insufficient_funds",
        message: "Insufficient funds.",
      },
      reviewPreparedSnapshot: { gas: "0x5208" },
    });
    expect(store.approvePendingProposal({ id: blockedId, updatedAt: 3 })).toEqual({
      status: "prepare_blocked",
      blocker: {
        reason: "transaction.prepare.insufficient_funds",
        message: "Insufficient funds.",
      },
    });

    const failedId = "failed-prepare-proposal";
    store.createPendingProposal({
      id: failedId,
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: {},
      },
      createdAt: 1,
      updatedAt: 1,
    });
    const failedSession = store.getOrStartPrepare({
      id: failedId,
      requestRevision: 0,
      updatedAt: 1,
    });
    if (failedSession.status !== "opened") {
      throw new Error("Prepare session not started");
    }
    store.settlePrepareFailed({
      id: failedId,
      expectedRequestRevision: 0,
      sessionToken: failedSession.review.sessionToken,
      updatedAt: 2,
      error: {
        reason: "transaction.prepare_failed",
        message: "RPC unavailable",
      },
      reviewPreparedSnapshot: null,
    });
    expect(store.approvePendingProposal({ id: failedId, updatedAt: 3 })).toEqual({
      status: "prepare_failed",
      prepareState: "failed",
      error: {
        reason: "transaction.prepare_failed",
        message: "RPC unavailable",
      },
    });
  });

  it("clears approved proposals after stored record persistence", () => {
    const store = createStore();
    const id = "77777777-7777-4777-8777-777777777777";

    store.createPendingProposal({
      id,
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: {},
      },
      createdAt: 1,
      updatedAt: 1,
    });
    store.updatePreparedForDraft({
      id,
      expectedRequestRevision: 0,
      updatedAt: 2,
      prepared: {},
    });
    const readyReview = store.getOrStartPrepare({
      id,
      requestRevision: 0,
      updatedAt: 2,
    });
    if (readyReview.status !== "opened") {
      throw new Error("Prepare session not started");
    }
    store.settlePrepareReady({
      id,
      expectedRequestRevision: 0,
      sessionToken: readyReview.review.sessionToken,
      updatedAt: 2,
      executionPrepared: {},
      reviewPreparedSnapshot: {},
    });
    expect(store.approvePendingProposal({ id, updatedAt: 2 })).toMatchObject({
      status: "approved",
    });

    expect(store.clearProposalAfterRecordPersisted(id)).toMatchObject({
      status: "cleared",
      proposal: {
        status: "approved",
      },
    });
    expect(store.getProposalSnapshot(id)).toBeUndefined();
    expect(store.listExecutableProposalIds()).toEqual([]);
  });

  it("starts and restarts prepare sessions for the current draft revision", () => {
    const store = createStore();
    const id = "88888888-8888-4888-8888-888888888888";

    store.createPendingProposal({
      id,
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: {},
      },
      createdAt: 1,
      updatedAt: 1,
    });

    const preparing = store.getOrStartPrepare({
      id,
      requestRevision: 0,
      updatedAt: 1,
    });
    expect(preparing).toMatchObject({
      status: "opened",
      review: {
        status: "preparing",
        updatedAt: 1,
      },
    });

    const restarted = store.restartPrepare({
      id,
      requestRevision: 0,
      updatedAt: 2,
    });
    expect(restarted).toMatchObject({
      status: "restarted",
      review: {
        status: "preparing",
        updatedAt: 2,
      },
    });
    if (preparing.status !== "opened" || restarted.status !== "restarted") {
      throw new Error("Prepare session not available");
    }
    expect(restarted.review.sessionToken).not.toBe(preparing.review.sessionToken);
  });

  it("settles blocked and ready prepare states on the active session", () => {
    const store = createStore();
    const id = "99999999-9999-4999-8999-999999999999";

    store.createPendingProposal({
      id,
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: {},
      },
      createdAt: 1,
      updatedAt: 1,
    });

    const preparing = store.getOrStartPrepare({
      id,
      requestRevision: 0,
      updatedAt: 1,
    });
    if (preparing.status !== "opened") {
      throw new Error("Prepare session not started");
    }

    expect(
      store.settlePrepareBlocked({
        id,
        expectedRequestRevision: 0,
        sessionToken: preparing.review.sessionToken,
        updatedAt: 2,
        blocker: {
          reason: "transaction.prepare.insufficient_funds",
          message: "Insufficient funds.",
        },
        reviewPreparedSnapshot: { gas: "0x5208" },
      }),
    ).toMatchObject({
      status: "settled",
      review: {
        status: "blocked",
        blocker: {
          reason: "transaction.prepare.insufficient_funds",
        },
        reviewPreparedSnapshot: { gas: "0x5208" },
      },
    });
    expect(store.getPreparedForExecution(id)).toBeNull();

    const restarted = store.restartPrepare({
      id,
      requestRevision: 0,
      updatedAt: 3,
    });
    if (restarted.status !== "restarted") {
      throw new Error("Prepare session not restarted");
    }

    expect(
      store.settlePrepareReady({
        id,
        expectedRequestRevision: 0,
        sessionToken: restarted.review.sessionToken,
        updatedAt: 4,
        executionPrepared: { gas: "0x5300" },
        reviewPreparedSnapshot: { gas: "0x5300" },
      }),
    ).toMatchObject({
      status: "settled",
      review: {
        status: "ready",
        reviewPreparedSnapshot: { gas: "0x5300" },
      },
    });
    expect(store.getPreparedForExecution(id)).toEqual({ gas: "0x5300" });
  });

  it("drops stale settlements and invalidates active prepare state from approval terminal events", () => {
    const store = createStore();
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    store.createPendingProposal({
      id,
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: {},
      },
      createdAt: 1,
      updatedAt: 1,
    });

    const initial = store.getOrStartPrepare({
      id,
      requestRevision: 0,
      updatedAt: 1,
    });
    if (initial.status !== "opened") {
      throw new Error("Prepare session not started");
    }

    store.replacePendingDraftRequest({
      id,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: { value: "0x1" },
      },
      updatedAt: 2,
    });

    expect(
      store.settlePrepareReady({
        id,
        expectedRequestRevision: 0,
        sessionToken: initial.review.sessionToken,
        updatedAt: 3,
        executionPrepared: { gas: "0x5208" },
        reviewPreparedSnapshot: { gas: "0x5208" },
      }),
    ).toEqual({
      status: "stale",
      requestRevision: 1,
      sessionToken: expect.any(String),
    });

    const current = store.getReviewState(id);
    expect(current).toMatchObject({
      status: "preparing",
    });

    expect(
      store.invalidatePrepareFromApproval(
        {
          approvalId: "approval-3",
          status: "cancelled",
          terminalReason: "locked",
          subject: { kind: "transaction", transactionId: id },
        },
        4,
      ),
    ).toMatchObject({
      status: "invalidated",
      invalidatedBy: "cancelled",
      error: {
        reason: "approval.cancelled",
      },
    });

    expect(
      store.settlePrepareFailed({
        id,
        expectedRequestRevision: 1,
        sessionToken: current?.sessionToken ?? "",
        updatedAt: 5,
        error: {
          reason: "transaction.prepare_failed",
          message: "stale",
        },
        reviewPreparedSnapshot: null,
      }),
    ).toEqual({
      status: "invalidated",
      invalidatedBy: "cancelled",
    });

    expect(
      store.invalidatePrepareFromApproval(
        {
          approvalId: "approval-3",
          status: "approved",
          terminalReason: "user_approve",
          subject: { kind: "transaction", transactionId: id },
        },
        6,
      ),
    ).toBeNull();
  });
});
