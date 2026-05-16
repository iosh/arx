import { describe, expect, it } from "vitest";
import { Messenger } from "../../messenger/Messenger.js";
import { TransactionProposalStore } from "./TransactionProposalStore.js";
import { TRANSACTION_TOPICS } from "./topics.js";

const createStore = () =>
  new TransactionProposalStore({
    messenger: new Messenger().scope({ publish: TRANSACTION_TOPICS }),
    accountCodecs: {
      toCanonicalAddressFromAccountKey: () => "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  });

const accountKey = "test-account-key";

describe("TransactionProposalStore", () => {
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
      error,
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
    expect(meta?.error).toEqual({ name: "Error", message: "boom", data: { code: "E_FAIL" } });
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
      error: { name: "Error", message: "boom", data: { code: "E_FAIL" } },
      createdAt: 1,
      updatedAt: 1,
    });

    if (created.request) {
      created.request.payload.gas = "0x9999";
    }
    if (created.prepared) {
      (created.prepared as { fee: { maxFeePerGas: string } }).fee.maxFeePerGas = "0x9";
    }
    if (created.error?.data && typeof created.error.data === "object") {
      (created.error.data as { code: string }).code = "E_CHANGED";
    }

    const reloaded = store.get("22222222-2222-4222-8222-222222222222");
    expect(reloaded?.request?.payload).toEqual({
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      gas: "0x5208",
    });
    expect(reloaded?.prepared).toEqual({ fee: { maxFeePerGas: "0x1" } });
    expect(reloaded?.error).toEqual({ name: "Error", message: "boom", data: { code: "E_FAIL" } });
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
    expect(store.peek("33333333-3333-4333-8333-333333333333")?.draftRevision).toBe(1);
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
      expectedDraftRevision: 0,
      updatedAt: 1,
      prepared: {},
    });
    store.approvePendingProposal({ id: "approved-proposal", updatedAt: 1 });

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
      phase: "approved",
    });
  });

  it("returns explicit fail outcomes for missing, inactive, and active proposals", () => {
    const store = createStore();

    expect(
      store.failProposal({
        id: "missing",
        updatedAt: 1,
        error: null,
        userRejected: false,
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
        userRejected: false,
      }),
    ).toMatchObject({
      status: "failed",
      proposal: {
        id: "failed-proposal",
        status: "failed",
        error: {
          message: "boom",
        },
      },
    });

    expect(
      store.failProposal({
        id: "failed-proposal",
        updatedAt: 3,
        error: { name: "Error", message: "late" },
        userRejected: false,
      }),
    ).toEqual({
      status: "not_active",
      phase: "failed",
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
        expectedDraftRevision: 1,
        updatedAt: 2,
        prepared: { gas: "0x5208" },
      }),
    ).toBeNull();

    expect(
      store.updatePreparedForDraft({
        id,
        expectedDraftRevision: 0,
        updatedAt: 3,
        prepared: { gas: "0x5208" },
      }),
    ).toMatchObject({
      prepared: { gas: "0x5208" },
      updatedAt: 3,
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
      expectedDraftRevision: 0,
      updatedAt: 1,
      prepared: {},
    });
    store.approvePendingProposal({ id: "55555555-5555-4555-8555-555555555555", updatedAt: 1 });

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

  it("clears approved proposals after durable record handoff", () => {
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
      expectedDraftRevision: 0,
      updatedAt: 2,
      prepared: {},
    });
    store.approvePendingProposal({ id, updatedAt: 2 });

    expect(store.clearProposalAfterRecordPersisted(id)).toMatchObject({
      status: "approved",
    });
    expect(store.getView(id)).toBeUndefined();
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
      draftRevision: 0,
      updatedAt: 1,
    });
    expect(preparing).toMatchObject({
      status: "preparing",
      updatedAt: 1,
    });

    const restarted = store.restartPrepare({
      id,
      draftRevision: 0,
      updatedAt: 2,
    });
    expect(restarted).toMatchObject({
      status: "preparing",
      updatedAt: 2,
    });
    expect(restarted?.sessionToken).not.toBe(preparing?.sessionToken);
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
      draftRevision: 0,
      updatedAt: 1,
    });
    if (!preparing) {
      throw new Error("Prepare session not started");
    }

    expect(
      store.settlePrepareBlocked({
        id,
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
    expect(store.getPreparedForExecution(id)).toBeNull();

    const restarted = store.restartPrepare({
      id,
      draftRevision: 0,
      updatedAt: 3,
    });
    if (!restarted) {
      throw new Error("Prepare session not restarted");
    }

    expect(
      store.settlePrepareReady({
        id,
        expectedDraftRevision: 0,
        sessionToken: restarted.sessionToken,
        updatedAt: 4,
        executionPrepared: { gas: "0x5300" },
        reviewPreparedSnapshot: { gas: "0x5300" },
      }),
    ).toMatchObject({
      status: "ready",
      reviewPreparedSnapshot: { gas: "0x5300" },
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
      draftRevision: 0,
      updatedAt: 1,
    });
    if (!initial) {
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
        expectedDraftRevision: 0,
        sessionToken: initial.sessionToken,
        updatedAt: 3,
        executionPrepared: { gas: "0x5208" },
        reviewPreparedSnapshot: { gas: "0x5208" },
      }),
    ).toBeNull();

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
      invalidatedBy: "locked",
      error: {
        reason: "approval.locked",
      },
    });

    expect(
      store.settlePrepareFailed({
        id,
        expectedDraftRevision: 1,
        sessionToken: current?.sessionToken ?? "",
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
          subject: { kind: "transaction", transactionId: id },
        },
        6,
      ),
    ).toBeNull();
  });
});
