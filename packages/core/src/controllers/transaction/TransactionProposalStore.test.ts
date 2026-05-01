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
  it("defensively copies created state so later caller mutations do not leak into proposal state", () => {
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
      userRejected: false,
      createdAt: 1,
      updatedAt: 1,
    });
    store.approvePendingProposal({ id: "11111111-1111-4111-8111-111111111111", updatedAt: 1 });
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
    expect(meta).not.toHaveProperty("locator");
    expect(meta).not.toHaveProperty("receipt");
    expect(meta).not.toHaveProperty("replacedId");
    expect(meta?.error).toEqual({ name: "Error", message: "boom", data: { code: "E_FAIL" } });
  });

  it("returns detached meta snapshots so consumer mutations do not write back into proposal state", () => {
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
      userRejected: false,
      createdAt: 1,
      updatedAt: 1,
    });
    store.approvePendingProposal({ id: "22222222-2222-4222-8222-222222222222", updatedAt: 1 });
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
    expect(reloaded).not.toHaveProperty("locator");
    expect(reloaded).not.toHaveProperty("receipt");
    expect(reloaded).not.toHaveProperty("replacedId");
    expect(reloaded?.error).toEqual({ name: "Error", message: "boom", data: { code: "E_FAIL" } });
  });

  it("projects proposal views without durable record fields", () => {
    const store = createStore();

    store.createPendingProposal({
      id: "2aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      approvalId: "2bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      baseRequest: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: { to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
      },
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: { to: "0xcccccccccccccccccccccccccccccccccccccccc" },
      },
      prepared: { gas: "0x5208" },
      createdAt: 1,
      updatedAt: 2,
    });
    store.approvePendingProposal({ id: "2aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", updatedAt: 2 });

    const view = store.getView("2aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    expect(view).toMatchObject({
      kind: "proposal",
      id: "2aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      approvalId: "2bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      phase: "approved",
      baseRequest: {
        payload: { to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
      },
      currentRequest: {
        payload: { to: "0xcccccccccccccccccccccccccccccccccccccccc" },
      },
      prepared: { gas: "0x5208" },
      review: {
        prepare: { state: "ready" },
      },
    });
    expect(view).not.toHaveProperty("submitted");
    expect(view).not.toHaveProperty("locator");
    expect(view).not.toHaveProperty("receipt");
    expect(view).not.toHaveProperty("replacedId");
  });

  it("increments draft revision and clears prepared state when replacing the draft request", () => {
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
        payload: { to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", gas: "0x5208" },
      },
      prepared: { fee: { maxFeePerGas: "0x1" } },
      createdAt: 1,
      updatedAt: 1,
    });

    const next = store.replacePendingDraftRequest({
      id: "33333333-3333-4333-8333-333333333333",
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: { to: "0xcccccccccccccccccccccccccccccccccccccccc", gas: "0x5300" },
      },
      updatedAt: 2,
    });

    expect(next?.request).toEqual({
      namespace: "eip155",
      chainRef: "eip155:1",
      payload: { to: "0xcccccccccccccccccccccccccccccccccccccccc", gas: "0x5300" },
    });
    expect(next?.prepared).toBeNull();
    expect(store.peek("33333333-3333-4333-8333-333333333333")?.draftRevision).toBe(1);
    expect(store.peek("33333333-3333-4333-8333-333333333333")?.preparedAtDraftRevision).toBeNull();
  });

  it("accepts prepared writes and lifecycle moves only when the expected revision or state still matches", () => {
    const store = createStore();

    store.createPendingProposal({
      id: "44444444-4444-4444-8444-444444444444",
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

    expect(store.commitPrepared("44444444-4444-4444-8444-444444444444", 0, { gas: "0x5208" })).toMatchObject({
      prepared: { gas: "0x5208" },
    });
    expect(store.peek("44444444-4444-4444-8444-444444444444")?.preparedAtDraftRevision).toBe(0);

    expect(
      store.replacePendingDraftRequest({
        id: "44444444-4444-4444-8444-444444444444",
        request: {
          namespace: "eip155",
          chainRef: "eip155:1",
          payload: { to: "0xcccccccccccccccccccccccccccccccccccccccc" },
        },
        updatedAt: 2,
      }),
    ).toMatchObject({
      request: {
        payload: { to: "0xcccccccccccccccccccccccccccccccccccccccc" },
      },
      prepared: null,
    });
    expect(store.peek("44444444-4444-4444-8444-444444444444")?.draftRevision).toBe(1);
    expect(store.peek("44444444-4444-4444-8444-444444444444")?.preparedAtDraftRevision).toBeNull();

    expect(store.commitPrepared("44444444-4444-4444-8444-444444444444", 0, { gas: "0x5300" })).toBeNull();
    expect(
      store.approvePendingProposal({
        id: "44444444-4444-4444-8444-444444444444",
        updatedAt: 3,
      }),
    ).toMatchObject({
      status: "approved",
    });
    expect(store.approvePendingProposal({ id: "44444444-4444-4444-8444-444444444444", updatedAt: 4 })).toBeNull();
    expect(store.clearProposalAfterRecordPersisted("44444444-4444-4444-8444-444444444444")).toMatchObject({
      status: "approved",
    });
  });

  it("owns review session state and rejects stale or invalidated review writes", () => {
    const store = createStore();
    const id = "4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

    const started = store.beginPrepareSession({ id, updatedAt: 2 });
    expect(started).toMatchObject({
      status: "preparing",
    });

    expect(
      store.markReviewBlocked({
        id,
        expectedDraftRevision: 0,
        sessionToken: started?.sessionToken ?? "",
        updatedAt: 3,
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

    store.replacePendingDraftRequest({
      id,
      request: {
        namespace: "eip155",
        chainRef: "eip155:1",
        payload: { to: "0xcccccccccccccccccccccccccccccccccccccccc" },
      },
      updatedAt: 4,
    });

    expect(
      store.markReviewReady({
        id,
        expectedDraftRevision: 0,
        sessionToken: started?.sessionToken ?? "",
        updatedAt: 5,
        reviewPreparedSnapshot: { gas: "0x5300" },
      }),
    ).toBeNull();

    const current = store.peek(id);
    const currentSession = store.beginPrepareSession({ id, updatedAt: 6 });
    expect(
      store.invalidateReviewFromApproval(
        {
          approvalId: "approval-1",
          status: "cancelled",
          terminalReason: "locked",
          subject: { kind: "transaction", transactionId: id },
        },
        7,
      ),
    ).toMatchObject({
      status: "invalidated",
      error: {
        reason: "approval.locked",
      },
    });

    expect(
      store.markReviewFailed({
        id,
        expectedDraftRevision: current?.draftRevision ?? 1,
        sessionToken: currentSession?.sessionToken ?? "",
        updatedAt: 8,
        error: {
          reason: "transaction.prepare_failed",
          message: "should be dropped",
        },
        reviewPreparedSnapshot: null,
      }),
    ).toBeNull();

    expect(store.getView(id)?.reviewState).toMatchObject({
      status: "invalidated",
      error: {
        reason: "approval.locked",
      },
    });
  });

  it("only lists approved proposals as executable recovery work", () => {
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
    store.approvePendingProposal({ id: "66666666-6666-4666-8666-666666666666", updatedAt: 1 });
    store.clearProposalAfterRecordPersisted("66666666-6666-4666-8666-666666666666");

    expect(store.listExecutableProposalIds()).toEqual(["55555555-5555-4555-8555-555555555555"]);
  });
});
