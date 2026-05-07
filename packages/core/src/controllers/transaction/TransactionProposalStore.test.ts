import { describe, expect, it } from "vitest";
import { Messenger } from "../../messenger/Messenger.js";
import { DEFAULT_CHAIN_REF, DEFAULT_FROM, DEFAULT_TO } from "./__fixtures__/transactionServices.js";
import { TransactionProposalStore } from "./TransactionProposalStore.js";
import { TRANSACTION_TOPICS } from "./topics.js";

const createStore = () => {
  const proposalStore = new TransactionProposalStore({
    messenger: new Messenger().scope({ publish: TRANSACTION_TOPICS }),
    accountCodecs: {
      toCanonicalAddressFromAccountKey: () => "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  });
  return {
    proposalStore,
  };
};

const accountKey = "test-account-key";

describe("TransactionProposalStore", () => {
  it("defensively copies created state so later caller mutations do not leak into proposal state", () => {
    const { proposalStore: store } = createStore();
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
      userRejected: false,
      createdAt: 1,
      updatedAt: 1,
    });
    const session = store.getOrStartPrepare({ id: "11111111-1111-4111-8111-111111111111", updatedAt: 1 });
    store.settlePrepareReady({
      id: "11111111-1111-4111-8111-111111111111",
      expectedDraftRevision: 0,
      sessionToken: session?.sessionToken ?? "",
      updatedAt: 1,
      executionPrepared: prepared,
      reviewPreparedSnapshot: prepared,
    });
    store.approveReadyProposal({ id: "11111111-1111-4111-8111-111111111111", updatedAt: 1 });
    request.payload.gas = "0x9999";
    prepared.fee.maxFeePerGas = "0x9";
    error.data.code = "E_CHANGED";

    const meta = store.get("11111111-1111-4111-8111-111111111111");
    expect(meta).not.toBeUndefined();
    expect(meta?.request?.payload).toEqual({
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      gas: "0x5208",
    });
    expect(meta?.prepared).toEqual({ fee: { maxFeePerGas: "0x1" } });
    expect(meta).not.toHaveProperty("submitted");
    expect(meta).not.toHaveProperty("receipt");
    expect(meta).not.toHaveProperty("replacedId");
    expect(meta?.error).toEqual({ name: "Error", message: "boom", data: { code: "E_FAIL" } });
  });

  it("returns detached meta snapshots so consumer mutations do not write back into proposal state", () => {
    const { proposalStore: store } = createStore();

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
      userRejected: false,
      createdAt: 1,
      updatedAt: 1,
    });
    const session = store.getOrStartPrepare({ id: "22222222-2222-4222-8222-222222222222", updatedAt: 1 });
    store.settlePrepareReady({
      id: "22222222-2222-4222-8222-222222222222",
      expectedDraftRevision: 0,
      sessionToken: session?.sessionToken ?? "",
      updatedAt: 1,
      executionPrepared: { fee: { maxFeePerGas: "0x1" } },
      reviewPreparedSnapshot: { fee: { maxFeePerGas: "0x1" } },
    });
    store.approveReadyProposal({ id: "22222222-2222-4222-8222-222222222222", updatedAt: 1 });
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
    expect(reloaded).not.toHaveProperty("submitted");
    expect(reloaded).not.toHaveProperty("receipt");
    expect(reloaded).not.toHaveProperty("replacedId");
    expect(reloaded?.error).toEqual({ name: "Error", message: "boom", data: { code: "E_FAIL" } });
  });

  it("projects proposal snapshots without durable record fields", () => {
    const { proposalStore: store } = createStore();

    store.createPendingProposal({
      id: "2aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      approvalId: "2bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: { to: "0xcccccccccccccccccccccccccccccccccccccccc" },
      },
      prepared: { gas: "0x5208" },
      createdAt: 1,
      updatedAt: 2,
    });
    const session = store.getOrStartPrepare({ id: "2aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", updatedAt: 2 });
    store.settlePrepareReady({
      id: "2aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expectedDraftRevision: 0,
      sessionToken: session?.sessionToken ?? "",
      updatedAt: 2,
      executionPrepared: { gas: "0x5208" },
      reviewPreparedSnapshot: { gas: "0x5208" },
    });
    store.approveReadyProposal({ id: "2aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", updatedAt: 2 });

    const view = store.getView("2aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    expect(view).toMatchObject({
      kind: "proposal",
      id: "2aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      approvalId: "2bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      phase: "approved",
      currentRequest: {
        payload: { to: "0xcccccccccccccccccccccccccccccccccccccccc" },
      },
      prepared: { gas: "0x5208" },
    });
    expect(view).not.toHaveProperty("submitted");
    expect(view).not.toHaveProperty("receipt");
    expect(view).not.toHaveProperty("replacedId");
  });

  it("keeps prepare state aligned with the current draft revision", () => {
    const { proposalStore: store } = createStore();

    store.createPendingProposal({
      id: "33333333-3333-4333-8333-333333333333",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: { to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", gas: "0x5208" },
      },
      createdAt: 1,
      updatedAt: 1,
    });

    const preparing = store.getOrStartPrepare({ id: "33333333-3333-4333-8333-333333333333", updatedAt: 2 });
    expect(preparing).toMatchObject({
      status: "preparing",
      updatedAt: 2,
    });

    const blocked = store.settlePrepareBlocked({
      id: "33333333-3333-4333-8333-333333333333",
      expectedDraftRevision: 0,
      sessionToken: preparing?.sessionToken ?? "",
      updatedAt: 3,
      blocker: {
        reason: "transaction.prepare.insufficient_funds",
        message: "Insufficient funds.",
      },
      reviewPreparedSnapshot: { gas: "0x5208" },
    });
    expect(blocked?.prepared).toBeNull();
    expect(store.getReviewState("33333333-3333-4333-8333-333333333333")).toMatchObject({
      status: "blocked",
      blocker: {
        reason: "transaction.prepare.insufficient_funds",
      },
      reviewPreparedSnapshot: { gas: "0x5208" },
    });

    const restarted = store.restartPrepare({
      id: "33333333-3333-4333-8333-333333333333",
      updatedAt: 4,
    });
    const ready = store.settlePrepareReady({
      id: "33333333-3333-4333-8333-333333333333",
      expectedDraftRevision: 0,
      sessionToken: restarted?.sessionToken ?? "",
      updatedAt: 5,
      executionPrepared: { gas: "0x5300" },
      reviewPreparedSnapshot: { gas: "0x5300" },
    });
    expect(ready).toMatchObject({
      prepared: { gas: "0x5300" },
      updatedAt: 5,
    });
    expect(store.getReviewState("33333333-3333-4333-8333-333333333333")).toMatchObject({
      status: "ready",
      reviewPreparedSnapshot: { gas: "0x5300" },
    });
    expect(store.getPreparedForExecution("33333333-3333-4333-8333-333333333333")).toEqual({
      gas: "0x5300",
    });
  });

  it("drops stale prepare settlements and invalidates prepare on approval terminal events except user approve", () => {
    const { proposalStore: store } = createStore();
    const id = "99999999-9999-4999-8999-999999999999";

    store.createPendingProposal({
      id,
      approvalId: "approval-9",
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

    const preparing = store.getOrStartPrepare({ id, updatedAt: 2 });
    store.replacePendingDraftRequest({
      id,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: { to: "0xcccccccccccccccccccccccccccccccccccccccc" },
      },
      updatedAt: 3,
    });

    expect(
      store.settlePrepareReady({
        id,
        expectedDraftRevision: 0,
        sessionToken: preparing?.sessionToken ?? "",
        updatedAt: 4,
        executionPrepared: { gas: "0x5208" },
        reviewPreparedSnapshot: { gas: "0x5208" },
      }),
    ).toBeNull();

    const current = store.getOrStartPrepare({ id, updatedAt: 5 });
    expect(
      store.invalidatePrepareFromApproval(
        {
          approvalId: "approval-9",
          status: "cancelled",
          terminalReason: "locked",
          subject: { kind: "transaction", transactionId: id },
        },
        6,
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
        updatedAt: 7,
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
          approvalId: "approval-9",
          status: "approved",
          terminalReason: "user_approve",
          subject: { kind: "transaction", transactionId: id },
        },
        8,
      ),
    ).toBeNull();
  });

  it("approves only ready prepared proposals for execution", () => {
    const { proposalStore: store } = createStore();
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
    const session = store.getOrStartPrepare({ id, updatedAt: 2 });
    store.settlePrepareReady({
      id,
      expectedDraftRevision: 0,
      sessionToken: session?.sessionToken ?? "",
      updatedAt: 3,
      executionPrepared: { gas: "0x5208" },
      reviewPreparedSnapshot: { gas: "0x5208" },
    });

    expect(store.approveReadyProposal({ id, updatedAt: 4 })).toMatchObject({
      status: "approved",
      transactionId: id,
    });
    expect(store.get(id)).toMatchObject({
      id,
      status: "approved",
      prepared: { gas: "0x5208" },
    });
  });

  it("rejects execution approval when the review state is missing", () => {
    const { proposalStore: store } = createStore();
    const id = "44444444-4444-4444-9444-444444444444";

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

    expect(store.approveReadyProposal({ id, updatedAt: 2 })).toMatchObject({
      status: "failed",
      reason: "prepare_not_ready",
      data: {
        transactionId: id,
        prepareState: "missing_review",
      },
    });
  });

  it("rejects execution approval when prepared params do not belong to the current draft", () => {
    const { proposalStore: store } = createStore();
    const id = "44444444-4444-4444-a444-444444444444";

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

    const session = store.getOrStartPrepare({ id, updatedAt: 2 });
    store.replacePendingDraftRequest({
      id,
      request: {
        namespace: "eip155",
        chainRef: DEFAULT_CHAIN_REF,
        payload: {
          from: DEFAULT_FROM,
          to: DEFAULT_TO,
          value: "0x1",
        },
      },
      updatedAt: 3,
    });

    expect(
      store.settlePrepareReady({
        id,
        expectedDraftRevision: 0,
        sessionToken: session?.sessionToken ?? "",
        updatedAt: 4,
        executionPrepared: { gas: "0x5208" },
        reviewPreparedSnapshot: { gas: "0x5208" },
      }),
    ).toBeNull();

    expect(store.approveReadyProposal({ id, updatedAt: 5 })).toMatchObject({
      status: "failed",
      reason: "prepare_not_ready",
      data: {
        transactionId: id,
      },
    });
    expect(store.get(id)?.status).toBe("pending");
  });

  it("blocks execution approval when review is not ready", () => {
    const { proposalStore: store } = createStore();
    const id = "44444444-4444-4444-b444-444444444444";

    store.createPendingProposal({
      id,
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: { to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", gas: "0x5208" },
      },
      createdAt: 1,
      updatedAt: 1,
    });

    store.getOrStartPrepare({ id, updatedAt: 2 });

    expect(store.approveReadyProposal({ id, updatedAt: 3 })).toMatchObject({
      status: "failed",
      reason: "prepare_not_ready",
      data: {
        transactionId: id,
        prepareState: "preparing",
      },
    });
    expect(store.get(id)?.status).toBe("pending");
  });

  it("fails execution approval when review is ready but execution prepared is missing", () => {
    const { proposalStore: store } = createStore();
    const id = "44444444-4444-4444-c444-444444444444";

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

    const session = store.getOrStartPrepare({ id, updatedAt: 2 });
    store.settlePrepareReady({
      id,
      expectedDraftRevision: 0,
      sessionToken: session?.sessionToken ?? "",
      updatedAt: 3,
      executionPrepared: null as never,
      reviewPreparedSnapshot: { gas: "0x5208" },
    });

    expect(store.approveReadyProposal({ id, updatedAt: 4 })).toMatchObject({
      status: "failed",
      reason: "prepare_failed",
      message: "Transaction prepared snapshot is missing.",
      data: {
        transactionId: id,
        prepareState: "ready_without_prepared",
      },
    });
  });

  it("only lists approved proposals as executable recovery work", () => {
    const { proposalStore: store } = createStore();

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
    const session1 = store.getOrStartPrepare({ id: "55555555-5555-4555-8555-555555555555", updatedAt: 1 });
    store.settlePrepareReady({
      id: "55555555-5555-4555-8555-555555555555",
      expectedDraftRevision: 0,
      sessionToken: session1?.sessionToken ?? "",
      updatedAt: 1,
      executionPrepared: {},
      reviewPreparedSnapshot: {},
    });
    store.approveReadyProposal({ id: "55555555-5555-4555-8555-555555555555", updatedAt: 1 });
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
    const session2 = store.getOrStartPrepare({ id: "66666666-6666-4666-8666-666666666666", updatedAt: 1 });
    store.settlePrepareReady({
      id: "66666666-6666-4666-8666-666666666666",
      expectedDraftRevision: 0,
      sessionToken: session2?.sessionToken ?? "",
      updatedAt: 1,
      executionPrepared: {},
      reviewPreparedSnapshot: {},
    });
    store.approveReadyProposal({ id: "66666666-6666-4666-8666-666666666666", updatedAt: 1 });
    store.clearProposalAfterRecordPersisted("66666666-6666-4666-8666-666666666666");

    expect(store.listExecutableProposalIds()).toEqual(["55555555-5555-4555-8555-555555555555"]);
  });

  it("removes an approved proposal once a durable record handoff succeeds", () => {
    const { proposalStore: store } = createStore();
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
    const session = store.getOrStartPrepare({ id, updatedAt: 2 });
    store.settlePrepareReady({
      id,
      expectedDraftRevision: 0,
      sessionToken: session?.sessionToken ?? "",
      updatedAt: 2,
      executionPrepared: {},
      reviewPreparedSnapshot: {},
    });
    store.approveReadyProposal({ id, updatedAt: 2 });

    expect(store.clearProposalAfterRecordPersisted(id)).toMatchObject({
      status: "approved",
    });
    expect(store.getView(id)).toBeUndefined();
    expect(store.listExecutableProposalIds()).toEqual([]);
  });
});
