import { describe, expect, it } from "vitest";
import { Messenger } from "../../messenger/Messenger.js";
import { RuntimeTransactionStore } from "./RuntimeTransactionStore.js";
import { TRANSACTION_TOPICS } from "./topics.js";

const createStore = () =>
  new RuntimeTransactionStore({
    messenger: new Messenger().scope({ publish: TRANSACTION_TOPICS }),
    accountCodecs: {
      toCanonicalAddressFromAccountKey: () => "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  });

const accountKey = "test-account-key";

describe("RuntimeTransactionStore", () => {
  it("defensively copies created state so later caller mutations do not leak into runtime state", () => {
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
    const submitted = {
      hash: "0x1234",
      chainId: "0x1",
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nonce: "0x7",
    };
    const locator = { format: "eip155.tx_hash" as const, value: "0x1234" };
    const receipt = { blockNumber: "0x10" };
    const error = { name: "Error", message: "boom", data: { code: "E_FAIL" } };

    store.create({
      id: "11111111-1111-4111-8111-111111111111",
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      request,
      prepared,
      status: "signed",
      submitted,
      locator,
      receipt,
      replacedId: "22222222-2222-4222-8222-222222222222",
      error,
      userRejected: false,
      createdAt: 1,
      updatedAt: 1,
    });

    request.payload.gas = "0x9999";
    prepared.fee.maxFeePerGas = "0x9";
    submitted.nonce = "0x9";
    locator.value = "0x9999";
    receipt.blockNumber = "0x99";
    error.data.code = "E_CHANGED";

    const meta = store.get("11111111-1111-4111-8111-111111111111");
    expect(meta).not.toBeUndefined();
    expect(meta?.request?.payload).toEqual({
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      gas: "0x5208",
    });
    expect(meta?.prepared).toEqual({ fee: { maxFeePerGas: "0x1" } });
    expect(meta?.submitted).toEqual({
      hash: "0x1234",
      chainId: "0x1",
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nonce: "0x7",
    });
    expect(meta?.locator).toEqual({ format: "eip155.tx_hash", value: "0x1234" });
    expect(meta?.receipt).toEqual({ blockNumber: "0x10" });
    expect(meta?.replacedId).toBe("22222222-2222-4222-8222-222222222222");
    expect(meta?.error).toEqual({ name: "Error", message: "boom", data: { code: "E_FAIL" } });
  });

  it("returns detached meta snapshots so consumer mutations do not write back into runtime state", () => {
    const store = createStore();

    const created = store.create({
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
      status: "approved",
      submitted: {
        hash: "0x1234",
        chainId: "0x1",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        nonce: "0x7",
      },
      locator: { format: "eip155.tx_hash", value: "0x1234" },
      receipt: { blockNumber: "0x10" },
      replacedId: "33333333-3333-4333-8333-333333333333",
      error: { name: "Error", message: "boom", data: { code: "E_FAIL" } },
      userRejected: false,
      createdAt: 1,
      updatedAt: 1,
    });

    created.request!.payload.gas = "0x9999";
    if (created.prepared) {
      (created.prepared as { fee: { maxFeePerGas: string } }).fee.maxFeePerGas = "0x9";
    }
    if (created.submitted) {
      (created.submitted as { nonce: string }).nonce = "0x9";
    }
    if (created.locator) {
      created.locator.value = "0x9999";
    }
    if (created.receipt) {
      (created.receipt as { blockNumber: string }).blockNumber = "0x99";
    }
    created.replacedId = "44444444-4444-4444-8444-444444444444";
    if (created.error?.data && typeof created.error.data === "object") {
      (created.error.data as { code: string }).code = "E_CHANGED";
    }

    const reloaded = store.get("22222222-2222-4222-8222-222222222222");
    expect(reloaded?.request?.payload).toEqual({
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      gas: "0x5208",
    });
    expect(reloaded?.prepared).toEqual({ fee: { maxFeePerGas: "0x1" } });
    expect(reloaded?.submitted).toEqual({
      hash: "0x1234",
      chainId: "0x1",
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nonce: "0x7",
    });
    expect(reloaded?.locator).toEqual({ format: "eip155.tx_hash", value: "0x1234" });
    expect(reloaded?.receipt).toEqual({ blockNumber: "0x10" });
    expect(reloaded?.replacedId).toBe("33333333-3333-4333-8333-333333333333");
    expect(reloaded?.error).toEqual({ name: "Error", message: "boom", data: { code: "E_FAIL" } });
  });

  it("increments draft revision and clears prepared state when replacing the draft request", () => {
    const store = createStore();

    store.create({
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
      status: "pending",
      createdAt: 1,
      updatedAt: 1,
    });

    const next = store.replaceDraftRequest({
      id: "33333333-3333-4333-8333-333333333333",
      fromStatus: "pending",
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
  });

  it("accepts prepared writes and status transitions only when the expected revision or status still matches", () => {
    const store = createStore();

    store.create({
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
      status: "pending",
      createdAt: 1,
      updatedAt: 1,
    });

    expect(store.commitPrepared("44444444-4444-4444-8444-444444444444", 0, { gas: "0x5208" })).toMatchObject({
      prepared: { gas: "0x5208" },
    });

    expect(
      store.replaceDraftRequest({
        id: "44444444-4444-4444-8444-444444444444",
        fromStatus: "pending",
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

    expect(store.commitPrepared("44444444-4444-4444-8444-444444444444", 0, { gas: "0x5300" })).toBeNull();
    expect(
      store.transition({
        id: "44444444-4444-4444-8444-444444444444",
        fromStatus: "pending",
        toStatus: "approved",
        updatedAt: 3,
      }),
    ).toMatchObject({
      status: "approved",
    });
    expect(
      store.transition({
        id: "44444444-4444-4444-8444-444444444444",
        fromStatus: "signed",
        toStatus: "broadcast",
        updatedAt: 4,
      }),
    ).toBeNull();
    expect(
      store.transition({
        id: "44444444-4444-4444-8444-444444444444",
        fromStatus: "approved",
        toStatus: "signed",
        updatedAt: 4,
      }),
    ).toMatchObject({
      status: "signed",
    });
  });

  it("only lists approved runtime transactions as executable recovery work", () => {
    const store = createStore();

    store.create({
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
      status: "approved",
      createdAt: 1,
      updatedAt: 1,
    });
    store.create({
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
      status: "signed",
      createdAt: 1,
      updatedAt: 1,
    });

    expect(store.listExecutableIds()).toEqual(["55555555-5555-4555-8555-555555555555"]);
  });
});
