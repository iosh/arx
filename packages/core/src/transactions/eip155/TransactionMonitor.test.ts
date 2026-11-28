import * as Hash from "ox/Hash";
import * as Hex from "ox/Hex";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChainJsonRpcOptions, createChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import { ChainJsonRpcResponseError } from "../../chainJsonRpc/errors.js";
import type { JsonRpcHttpRequest, JsonRpcHttpTransport } from "../../chainJsonRpc/JsonRpcHttpTransport.js";
import { createEip155RawTransactionBroadcaster } from "../../namespaces/eip155/broadcastRawTransaction.js";
import type { ChainRef } from "../../networks/chainRef.js";
import { createCoreMutationQueue } from "../../persistence/mutationQueue.js";
import { systemTime } from "../../runtime/time.js";
import type { PendingTransactionRecord, Transaction, TransactionRecord } from "../persistence.js";
import { createEip155TransactionSubmitter } from "./submitTransaction.js";
import { TransactionMonitor } from "./TransactionMonitor.js";

const BLOCK_POLL_INTERVAL_MS = 20_000;

const pendingRecord = {
  transactionId: "transaction-1",
  namespace: "eip155",
  chainRef: "eip155:1",
  accountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  initiator: { type: "wallet" },
  hash: Hash.keccak256("0xdeadbeef"),
  transaction: {
    from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    value: "0x0",
    data: "0x",
    gas: "0x5208",
    nonce: "0x1",
    type: "legacy",
    gasPrice: "0x1",
  },
  state: { status: "pending" },
  recovery: { rawTransaction: "0xdeadbeef" },
  createdAt: 1,
  updatedAt: 1,
} satisfies PendingTransactionRecord;

const replacementRecord = {
  ...pendingRecord,
  transactionId: "transaction-2",
  replacesTransactionId: pendingRecord.transactionId,
  replacementType: "speed-up",
  hash: Hash.keccak256("0xcafebabe"),
  transaction: { ...pendingRecord.transaction, gasPrice: "0x2" },
  recovery: { rawTransaction: "0xcafebabe" },
  createdAt: 2,
  updatedAt: 2,
} satisfies PendingTransactionRecord;

const { recovery: _recovery, ...replacement } = replacementRecord;
const failedReplacement = {
  ...replacement,
  state: { status: "failed", failure: { type: "broadcast", code: -32000, message: "replacement underpriced" } },
} satisfies Transaction;
const cancellation = {
  ...replacementRecord,
  transactionId: "transaction-3",
  replacesTransactionId: replacementRecord.transactionId,
  replacementType: "cancel",
  transaction: { ...replacementRecord.transaction, to: pendingRecord.transaction.from, gasPrice: "0x3" },
  recovery: { rawTransaction: "0xfeedface" },
  hash: Hash.keccak256("0xfeedface"),
  createdAt: 3,
  updatedAt: 3,
} satisfies PendingTransactionRecord;

const confirmation = {
  blockHash: Hash.keccak256("0x01"),
  blockNumber: "0x1",
  transactionIndex: "0x0",
  gasUsed: "0x5208",
};

const receipt = (hash: string, status: "0x0" | "0x1" = "0x1") => ({
  ...confirmation,
  transactionHash: hash,
  contractAddress: null,
  status,
});

const rpcEndpoint = (chainRef: ChainRef) => `https://rpc.example/${chainRef}`;

const createHarness = (
  respond: (input: JsonRpcHttpRequest) => unknown,
  savedTransactions: readonly Transaction[] = [],
) => {
  const events: string[][] = [];
  const commits: TransactionRecord[][] = [];
  let blockNumber = 1;
  const request = vi.fn(async (input: JsonRpcHttpRequest) =>
    input.method === "eth_blockNumber" ? Hex.fromNumber(blockNumber) : respond(input),
  );
  const rpcOptions = {
    endpoints: { getRpcEndpoints: (chainRef) => [rpcEndpoint(chainRef)] },
    transport: { request: request as JsonRpcHttpTransport["request"] },
  } satisfies ChainJsonRpcOptions;
  const { broadcast } = createEip155TransactionSubmitter({
    broadcastRawTransaction: createEip155RawTransactionBroadcaster(rpcOptions),
    signing: {
      async signDigest() {
        throw new Error("Monitoring uses saved signatures.");
      },
    },
  });
  const mutations = createCoreMutationQueue({
    commit: async (changes) => {
      commits.push(
        changes.map((change) => {
          assert(change.persistenceType === "transaction" && change.operation === "put");
          return change.value;
        }),
      );
    },
  });
  const monitor = new TransactionMonitor({
    chainJsonRpc: createChainJsonRpc(rpcOptions),
    transactions: { get: async (id) => savedTransactions.find(({ transactionId }) => transactionId === id) ?? null },
    broadcast,
    mutations,
    time: systemTime,
    publishChanged: ({ transactionIds }) => events.push([...transactionIds]),
  });

  const rpcParams = (method: string) =>
    request.mock.calls.flatMap(([input]) => (input.method === method ? [input.params] : []));
  const setBlockNumber = (height: number) => {
    blockNumber = height;
  };
  const advanceBlock = async () => {
    blockNumber++;
    await vi.advanceTimersByTimeAsync(BLOCK_POLL_INTERVAL_MS);
  };
  return { monitor, request, commits, events, rpcParams, setBlockNumber, advanceBlock };
};

describe("TransactionMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("recovers only the latest intent across a failed replacement and settles while its broadcast is pending", async () => {
    const { hash: originalHash, ...olderPendingRecord } = pendingRecord;
    const broadcast = Promise.withResolvers<Hex.Hex>();
    let hashLookups = 0;
    let mined = false;
    const { monitor, commits, events, rpcParams, advanceBlock } = createHarness(
      ({ method, params }) => {
        if (method === "eth_getTransactionReceipt") {
          return mined && Array.isArray(params) && params[0] === cancellation.hash ? receipt(cancellation.hash) : null;
        }
        if (method === "eth_getTransactionCount") return "0x1";
        if (method === "eth_getTransactionByHash") {
          expect(params).toEqual([cancellation.hash]);
          if (++hashLookups === 1) throw new ChainJsonRpcResponseError({ rpcCode: -32000, message: "RPC unavailable" });
          return null;
        }
        if (method === "eth_sendRawTransaction") return broadcast.promise;
        throw new Error(`Unexpected RPC method: ${method}`);
      },
      [failedReplacement],
    );
    monitor.restore([olderPendingRecord, cancellation]);
    await vi.advanceTimersByTimeAsync(0);
    expect(rpcParams("eth_sendRawTransaction")).toEqual([]);

    await vi.advanceTimersByTimeAsync(2 * BLOCK_POLL_INTERVAL_MS);
    expect(hashLookups).toBe(2);
    expect(rpcParams("eth_sendRawTransaction")).toEqual([[cancellation.recovery.rawTransaction]]);
    expect(commits).toEqual([]);

    mined = true;
    await advanceBlock();
    expect(commits).toMatchObject([
      [
        {
          transactionId: pendingRecord.transactionId,
          hash: originalHash,
          state: { status: "replaced", replacement: { type: "local", transactionId: cancellation.transactionId } },
        },
        {
          transactionId: cancellation.transactionId,
          hash: cancellation.hash,
          replacementType: "cancel",
          state: { status: "confirmed", confirmation },
        },
      ],
    ]);
    expect(commits[0]?.every((record) => !("recovery" in record))).toBe(true);
    expect(events).toEqual([[pendingRecord.transactionId, cancellation.transactionId]]);
    expect(rpcParams("eth_sendRawTransaction")).toEqual([[cancellation.recovery.rawTransaction]]);
    broadcast.resolve(cancellation.hash);
  });

  it("tracks both branches without broadcasting when the saved replacements leave two candidates", async () => {
    const otherSpeedUp = {
      ...replacementRecord,
      transactionId: "transaction-4",
      hash: Hash.keccak256("0xdecafbad"),
      recovery: { rawTransaction: "0xdecafbad" },
      transaction: { ...replacementRecord.transaction, gasPrice: "0x4" },
      createdAt: 4,
      updatedAt: 4,
    } satisfies PendingTransactionRecord;
    let mined = false;
    const { monitor, commits, rpcParams, advanceBlock } = createHarness(
      ({ method, params }) => {
        if (method === "eth_getTransactionReceipt") {
          return mined && Array.isArray(params) && params[0] === otherSpeedUp.hash ? receipt(otherSpeedUp.hash) : null;
        }
        if (method === "eth_getTransactionCount") return "0x1";
        if (method === "eth_getTransactionByHash") return null;
        if (method === "eth_sendRawTransaction") return otherSpeedUp.hash;
        throw new Error(`Unexpected RPC method: ${method}`);
      },
      [failedReplacement],
    );

    monitor.restore([pendingRecord, cancellation, otherSpeedUp]);
    await vi.advanceTimersByTimeAsync(0);
    expect(rpcParams("eth_sendRawTransaction")).toEqual([]);

    mined = true;
    await advanceBlock();
    expect(commits[0]?.map(({ state }) => state.status)).toEqual(["replaced", "replaced", "confirmed"]);
  });

  it("ends the startup attempt on rejection and keeps tracking the original hash", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failure = new ChainJsonRpcResponseError({ rpcCode: -32000, message: "insufficient funds" });
    let mined = false;
    const { monitor, commits, rpcParams, advanceBlock } = createHarness(({ method }) => {
      if (method === "eth_getTransactionReceipt") return mined ? receipt(pendingRecord.hash) : null;
      if (method === "eth_getTransactionCount") return "0x1";
      if (method === "eth_getTransactionByHash") return null;
      if (method === "eth_sendRawTransaction") throw failure;
      throw new Error(`Unexpected RPC method: ${method}`);
    });

    monitor.restore([pendingRecord]);
    await vi.advanceTimersByTimeAsync(2 * BLOCK_POLL_INTERVAL_MS);
    expect(rpcParams("eth_sendRawTransaction")).toEqual([[pendingRecord.recovery.rawTransaction]]);
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      expect.objectContaining({ transactionId: pendingRecord.transactionId, message: failure.message }),
    );
    expect(commits).toEqual([]);

    mined = true;
    await advanceBlock();
    expect(rpcParams("eth_getTransactionReceipt").at(-1)).toEqual([pendingRecord.hash]);
    expect(commits).toMatchObject([[{ hash: pendingRecord.hash, state: { status: "confirmed", confirmation } }]]);
  });

  it("lets a newly saved replacement take precedence while the original hash lookup is pending", async () => {
    const hashLookup = Promise.withResolvers<null>();
    const { monitor, rpcParams } = createHarness(({ method }) => {
      if (method === "eth_getTransactionReceipt") return null;
      if (method === "eth_getTransactionCount") return "0x1";
      if (method === "eth_getTransactionByHash") return hashLookup.promise;
      if (method === "eth_sendRawTransaction") return pendingRecord.hash;
      throw new Error(`Unexpected RPC method: ${method}`);
    });

    monitor.restore([pendingRecord]);
    await vi.advanceTimersByTimeAsync(0);
    expect(rpcParams("eth_getTransactionByHash")).toEqual([[pendingRecord.hash]]);

    monitor.track(replacementRecord);
    hashLookup.resolve(null);
    await vi.advanceTimersByTimeAsync(BLOCK_POLL_INTERVAL_MS);
    expect(rpcParams("eth_sendRawTransaction")).toEqual([]);
  });

  it("confirms another transaction on the same chain while startup recovery waits for a hash lookup", async () => {
    const otherTransaction = {
      ...pendingRecord,
      transactionId: "other-transaction",
      accountId: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      transaction: { ...pendingRecord.transaction, from: pendingRecord.transaction.to },
      hash: Hash.keccak256("0x0123"),
      recovery: { rawTransaction: "0x0123" },
    } satisfies PendingTransactionRecord;
    const hashLookup = Promise.withResolvers<null>();
    let nextNonce: Hex.Hex = "0x1";
    const { monitor, commits, rpcParams, advanceBlock } = createHarness(({ method, params }) => {
      if (method === "eth_getTransactionReceipt") {
        return Array.isArray(params) && params[0] === otherTransaction.hash
          ? { ...receipt(otherTransaction.hash), blockNumber: "0x2" }
          : null;
      }
      if (method === "eth_getTransactionCount") return nextNonce;
      if (method === "eth_getTransactionByHash") return hashLookup.promise;
      if (method === "eth_sendRawTransaction") return pendingRecord.hash;
      throw new Error(`Unexpected RPC method: ${method}`);
    });

    monitor.restore([pendingRecord]);
    await vi.advanceTimersByTimeAsync(0);
    expect(rpcParams("eth_getTransactionByHash")).toEqual([[pendingRecord.hash]]);

    monitor.track(otherTransaction);
    await advanceBlock();
    expect(commits).toMatchObject([
      [{ transactionId: otherTransaction.transactionId, state: { status: "confirmed" } }],
    ]);
    expect(rpcParams("eth_getTransactionByHash")).toEqual([[pendingRecord.hash]]);

    nextNonce = "0x2";
    await advanceBlock();
    hashLookup.resolve(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(rpcParams("eth_sendRawTransaction")).toEqual([]);
  });

  it("finishes startup recovery for a consumed nonce or a hash the node knows", async () => {
    const nextNonceRecord = {
      ...pendingRecord,
      transactionId: "transaction-3",
      hash: Hash.keccak256("0xfeedface"),
      transaction: { ...pendingRecord.transaction, nonce: "0x2" },
      recovery: { rawTransaction: "0xfeedface" },
    } satisfies PendingTransactionRecord;
    const { monitor, rpcParams, commits } = createHarness(({ method }) => {
      if (method === "eth_getTransactionReceipt") return null;
      if (method === "eth_getTransactionCount") return "0x2";
      if (method === "eth_getTransactionByHash") return { hash: nextNonceRecord.hash };
      throw new Error(`Unexpected RPC method: ${method}`);
    });

    monitor.restore([pendingRecord, nextNonceRecord]);
    await vi.advanceTimersByTimeAsync(BLOCK_POLL_INTERVAL_MS);
    expect(rpcParams("eth_getTransactionByHash")).toEqual([[nextNonceRecord.hash]]);
    expect(rpcParams("eth_sendRawTransaction")).toEqual([]);
    expect(commits).toEqual([]);
  });

  it("uses a replacement's execution receipt when the original hash lookup errors", async () => {
    let mined = false;
    let indexAvailable = false;
    const indexError = new ChainJsonRpcResponseError({
      rpcCode: -32000,
      message: "transaction indexing is in progress",
    });
    const { monitor, commits, advanceBlock } = createHarness(({ method, params }) => {
      if (method === "eth_getTransactionCount") return "0x2";
      if (method === "eth_getTransactionReceipt") {
        if (!indexAvailable && Array.isArray(params) && params[0] === pendingRecord.hash) throw indexError;
        if (!mined) return null;
        return receipt(replacementRecord.hash, "0x0");
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    });

    monitor.track(pendingRecord);
    monitor.track(replacementRecord);
    await vi.advanceTimersByTimeAsync(0);
    indexAvailable = true;
    await advanceBlock();
    await advanceBlock();
    await advanceBlock();
    expect(commits).toEqual([]);

    indexAvailable = false;
    mined = true;
    await advanceBlock();
    expect(commits).toMatchObject([
      [
        {
          hash: pendingRecord.hash,
          state: { status: "replaced", replacement: { type: "local", transactionId: replacementRecord.transactionId } },
        },
        {
          hash: replacementRecord.hash,
          state: { status: "failed", failure: { type: "execution", inclusion: confirmation } },
        },
      ],
    ]);
  });

  it("retains the original hash and stops polling after four observations of a consumed nonce", async () => {
    const unavailable = new ChainJsonRpcResponseError({ rpcCode: -32000, message: "RPC unavailable" });
    const nextNonces = ["0x2", unavailable, "0x1", "0x2", "0x2", "0x2"];
    const { monitor, request, commits, events, rpcParams, advanceBlock } = createHarness(({ method }) => {
      if (method === "eth_getTransactionReceipt") return null;
      if (method === "eth_getTransactionCount") {
        const nextNonce = nextNonces.shift();
        if (nextNonce instanceof Error) throw nextNonce;
        assert(nextNonce);
        return nextNonce;
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    });

    monitor.track(pendingRecord);
    await vi.advanceTimersByTimeAsync(3 * BLOCK_POLL_INTERVAL_MS);
    expect(rpcParams("eth_getTransactionReceipt")).toEqual([[pendingRecord.hash]]);
    expect(rpcParams("eth_blockNumber")).toHaveLength(4);

    for (let block = 0; block < 4; block++) await advanceBlock();
    expect(commits).toEqual([]);
    expect(events).toEqual([]);

    await advanceBlock();
    expect(commits).toMatchObject([
      [{ transactionId: pendingRecord.transactionId, hash: pendingRecord.hash, state: { status: "dropped" } }],
    ]);
    expect(commits[0]?.[0]).not.toHaveProperty("recovery");
    expect(events).toEqual([[pendingRecord.transactionId]]);

    request.mockClear();
    await advanceBlock();
    expect(request).not.toHaveBeenCalled();
  });

  it("counts consumed nonce observations only at increasing block heights", async () => {
    const { monitor, commits, rpcParams, setBlockNumber, advanceBlock } = createHarness(({ method }) => {
      if (method === "eth_getTransactionReceipt") return null;
      if (method === "eth_getTransactionCount") return "0x2";
      throw new Error(`Unexpected RPC method: ${method}`);
    });

    const heights = [100, 101, 100, 101];
    monitor.track(pendingRecord);
    for (const height of heights) {
      setBlockNumber(height);
      await vi.advanceTimersByTimeAsync(BLOCK_POLL_INTERVAL_MS);
    }
    expect(commits).toEqual([]);

    await advanceBlock();
    expect(commits).toEqual([]);

    await advanceBlock();
    expect(commits).toMatchObject([[{ transactionId: pendingRecord.transactionId, state: { status: "dropped" } }]]);
    expect(rpcParams("eth_getTransactionCount")).toEqual(
      [...heights, 102, 103].map((height) => [pendingRecord.transaction.from, Hex.fromNumber(height)]),
    );
  });

  it("settles an unaffected nonce group while deferring the group that gained a replacement", async () => {
    const nextTransaction = {
      ...pendingRecord,
      transactionId: "next-transaction",
      hash: Hash.keccak256("0x0123"),
      recovery: { rawTransaction: "0x0123" },
      transaction: { ...pendingRecord.transaction, nonce: "0x2" },
    } satisfies PendingTransactionRecord;
    const nextReplacement = {
      ...replacementRecord,
      replacesTransactionId: nextTransaction.transactionId,
      transaction: { ...replacementRecord.transaction, nonce: "0x2" },
    } satisfies PendingTransactionRecord;
    const response = Promise.withResolvers<ReturnType<typeof receipt>>();
    const { monitor, commits, rpcParams } = createHarness(({ method, params }) => {
      if (method === "eth_getTransactionReceipt" && Array.isArray(params)) {
        if (params[0] === pendingRecord.hash) return response.promise;
        if (params[0] === nextTransaction.hash) return { ...receipt(nextTransaction.hash), transactionIndex: "0x1" };
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    monitor.track(pendingRecord);
    monitor.track(nextTransaction);
    await vi.advanceTimersByTimeAsync(0);
    expect(rpcParams("eth_getTransactionReceipt")).toEqual([[pendingRecord.hash]]);

    monitor.track(nextReplacement);
    response.resolve(receipt(pendingRecord.hash));
    await vi.advanceTimersByTimeAsync(0);
    expect(commits).toMatchObject([[{ transactionId: pendingRecord.transactionId, state: { status: "confirmed" } }]]);

    await vi.advanceTimersByTimeAsync(BLOCK_POLL_INTERVAL_MS);
    expect(commits[1]).toMatchObject([
      { transactionId: nextTransaction.transactionId, state: { status: "confirmed" } },
      {
        transactionId: nextReplacement.transactionId,
        state: { status: "replaced", replacement: { type: "local", transactionId: nextTransaction.transactionId } },
      },
    ]);
  });

  it("confirms transactions on a healthy chain while another chain is still waiting for a receipt", async () => {
    const otherChainRecord = {
      ...pendingRecord,
      transactionId: "transaction-3",
      chainRef: "eip155:10",
    } satisfies PendingTransactionRecord;
    const firstChainEndpoint = rpcEndpoint(pendingRecord.chainRef);
    const firstChainReceipt = Promise.withResolvers<null>();
    let otherChainMined = false;
    const { monitor, request, commits, advanceBlock } = createHarness(({ endpoint, method }) => {
      if (method === "eth_getTransactionCount") return "0x1";
      if (method !== "eth_getTransactionReceipt") throw new Error(`Unexpected RPC method: ${method}`);
      if (endpoint === firstChainEndpoint) return firstChainReceipt.promise;
      return otherChainMined ? receipt(otherChainRecord.hash) : null;
    });
    const firstChainReceiptChecks = () =>
      request.mock.calls.filter(
        ([input]) => input.endpoint === firstChainEndpoint && input.method === "eth_getTransactionReceipt",
      );

    monitor.track(pendingRecord);
    monitor.track(otherChainRecord);
    await vi.advanceTimersByTimeAsync(0);
    expect(commits).toEqual([]);

    otherChainMined = true;
    await advanceBlock();
    expect(commits).toMatchObject([
      [{ transactionId: otherChainRecord.transactionId, state: { status: "confirmed" } }],
    ]);
    expect(firstChainReceiptChecks()).toHaveLength(1);

    firstChainReceipt.resolve(null);
    await advanceBlock();
    expect(firstChainReceiptChecks()).toHaveLength(2);
  });
});
