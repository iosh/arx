import { Hash, Hex } from "ox";
import { assert, describe, expect, it, vi } from "vitest";
import { createChainJsonRpc } from "../chainJsonRpc/ChainJsonRpc.js";
import { ChainJsonRpcResponseError } from "../chainJsonRpc/errors.js";
import {
  ChainJsonRpcHttpTransportError,
  type JsonRpcHttpRequest,
  type JsonRpcHttpTransport,
} from "../chainJsonRpc/JsonRpcHttpTransport.js";
import {
  ACCOUNT_ID,
  ADDRESS,
  createAccounts,
  createNetworks,
  KEY_SOURCE_ID,
  PRIVATE_KEY,
} from "../namespaces/eip155/__tests__/fixtures.js";
import type { Eip155AccountSigning } from "../namespaces/eip155/accountSigning.js";
import { createEip155RawTransactionBroadcaster } from "../namespaces/eip155/broadcastRawTransaction.js";
import { signEip155Digest } from "../namespaces/eip155/keyring.js";
import type { PersistenceWriter } from "../persistence/corePersistence.js";
import { PersistenceCommitError } from "../persistence/errors.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { CoreTime } from "../runtime/time.js";
import { WalletLockedError } from "../wallet/errors.js";
import { createEip155TransactionsAdapter } from "./eip155/adapter.js";
import { TransactionMonitor } from "./eip155/TransactionMonitor.js";
import {
  type PendingTransactionRecord,
  type TransactionsReader,
  transactionRecordToTransaction,
} from "./persistence.js";
import type { PreparedTransaction } from "./preparedTransaction.js";
import { createTransactions, type TransactionsChanged } from "./Transactions.js";
import type { Transaction, TransactionId } from "./types.js";

const CHAIN_REF = "eip155:1";
const BLOCK_NUMBER = "0x10";
const TRANSACTION_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const prepared = (replacesTransactionId?: TransactionId): PreparedTransaction => ({
  namespace: "eip155",
  chainRef: CHAIN_REF,
  accountId: ACCOUNT_ID,
  initiator: { type: "wallet" },
  ...(replacesTransactionId === undefined ? {} : { replacesTransactionId, replacementType: "speed-up" }),
  transaction: {
    from: ADDRESS,
    to: null,
    value: "0x0",
    data: "0x",
    gas: "0x5208",
    type: "legacy",
    gasPrice: "0x1",
  },
});

const replacementTarget: Transaction = {
  ...prepared(),
  transactionId: "transaction-target",
  hash: TRANSACTION_HASH,
  transaction: {
    ...prepared().transaction,
    nonce: "0x1",
    to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    value: "0x123",
    data: "0xabcd",
    gas: "0x10000",
  },
  state: { status: "pending" },
  createdAt: 1,
  updatedAt: 1,
};

const pendingReplacement: PendingTransactionRecord = {
  ...replacementTarget,
  transactionId: "transaction-replacement",
  replacesTransactionId: replacementTarget.transactionId,
  replacementType: "speed-up",
  hash: Hash.keccak256("0xcafebabe"),
  state: { status: "pending" },
  recovery: { rawTransaction: "0xcafebabe" },
};

const createFixture = (target: Transaction | null = null) => {
  const accounts = createAccounts();
  const networks = createNetworks();
  const broadcast = vi.fn(async (rawTransaction: Hex.Hex) => Hash.keccak256(rawTransaction));
  const receipt = vi.fn<(hash: Hex.Hex) => Promise<unknown>>(async () => null);
  const request = vi.fn(async ({ method, params }: JsonRpcHttpRequest): Promise<unknown> => {
    if (method === "eth_getTransactionCount") return "0x1";
    if (method === "eth_blockNumber") return BLOCK_NUMBER;
    if (method === "eth_getCode") return "0x";
    if (method === "eth_gasPrice") return "0x30";
    if (method === "eth_estimateGas") return "0x88b8";
    if (method === "eth_sendRawTransaction") {
      assert(Array.isArray(params) && Hex.validate(params[0]));
      return broadcast(params[0]);
    }
    if (method === "eth_getTransactionReceipt") {
      assert(Array.isArray(params) && Hex.validate(params[0]));
      return receipt(params[0]);
    }
    throw new Error(`Unexpected RPC method: ${method}`);
  });
  const rpcOptions = { endpoints: networks, transport: { request: request as JsonRpcHttpTransport["request"] } };
  const chainJsonRpc = createChainJsonRpc(rpcOptions);
  const records = new Map<TransactionId, Transaction>();
  if (target) records.set(target.transactionId, target);
  const listPending = vi.fn<TransactionsReader["listPending"]>(async () => []);
  const reader: TransactionsReader = {
    get: async (id) => records.get(id) ?? null,
    list: async () => ({ transactions: [] }),
    listPending,
  };
  const signDigest = vi.fn<Eip155AccountSigning["signDigest"]>(async (input) => {
    const privateKey = Hex.toBytes(`0x${PRIVATE_KEY}`);
    try {
      return signEip155Digest({ ...input, privateKey });
    } finally {
      privateKey.fill(0);
    }
  });
  const adapter = createEip155TransactionsAdapter({
    chainJsonRpc,
    broadcastRawTransaction: createEip155RawTransactionBroadcaster(rpcOptions),
    pendingTransactionsReader: reader,
    signing: { signDigest },
  });
  const commit = vi.fn<PersistenceWriter["commit"]>(async (changes) => {
    for (const change of changes) {
      assert(change.persistenceType === "transaction" && change.operation === "put");
      records.set(change.value.transactionId, transactionRecordToTransaction(change.value));
    }
  });
  const publishChanged = vi.fn<(change: TransactionsChanged) => void>();
  const schedule = vi.fn<CoreTime["schedule"]>(() => () => {});
  const time = { now: () => 100, schedule };
  const mutations = createCoreMutationQueue({ commit });
  const adapters = { eip155: adapter };
  const monitor = new TransactionMonitor({
    chainJsonRpc,
    transactions: reader,
    broadcast: adapter.broadcast,
    mutations,
    time,
    publishChanged,
  });
  const transactions = createTransactions({
    readers: { transactions: reader },
    accounts,
    networks,
    mutations,
    time,
    adapters,
    monitor,
    publishChanged,
  });

  return {
    transactions,
    accounts,
    networks,
    commit,
    request,
    broadcast,
    receipt,
    signDigest,
    listPending,
    schedule,
    publishChanged,
  };
};

const committedRecord = (commit: ReturnType<typeof createFixture>["commit"], call = 0) => {
  const changes = commit.mock.calls[call]?.[0];
  assert(changes?.length === 1);
  const change = changes[0];
  assert(change?.persistenceType === "transaction" && change.operation === "put");
  return change.value;
};

describe("Transactions.submit", () => {
  it("commits the hash and signed bytes before broadcasting those exact bytes", async () => {
    const fixture = createFixture();
    const persistence = Promise.withResolvers<void>();
    const write = fixture.commit.getMockImplementation();
    assert(write);
    fixture.commit.mockImplementationOnce(async (changes) => {
      await persistence.promise;
      await write(changes);
    });

    const pending = fixture.transactions.submit(prepared());
    try {
      await vi.waitFor(() => expect(fixture.commit).toHaveBeenCalledOnce());
      const record = committedRecord(fixture.commit);
      assert(record.recovery);
      expect(record.hash).toBe(Hash.keccak256(record.recovery.rawTransaction));
      expect(fixture.broadcast).not.toHaveBeenCalled();
      expect(fixture.publishChanged).not.toHaveBeenCalled();
    } finally {
      persistence.resolve();
    }
    const submission = await pending;
    const record = committedRecord(fixture.commit);
    assert(record.recovery);

    expect(submission).toMatchObject({
      status: "pending",
      transactionHash: record.hash,
      transaction: { chainRef: CHAIN_REF, accountId: ACCOUNT_ID, hash: record.hash, state: { status: "pending" } },
    });
    expect(submission.transaction).not.toHaveProperty("recovery");
    expect(fixture.broadcast).toHaveBeenCalledWith(record.recovery.rawTransaction);
    expect(fixture.publishChanged).toHaveBeenCalledWith({
      type: "transactionsChanged",
      transactionIds: [submission.transaction.transactionId],
    });
  });

  it("does not broadcast or publish when the recovery commit fails", async () => {
    const fixture = createFixture();
    const failure = new PersistenceCommitError(new Error("IndexedDB transaction aborted"));
    fixture.commit.mockRejectedValueOnce(failure);

    await expect(fixture.transactions.submit(prepared())).rejects.toBe(failure);
    expect(fixture.broadcast).not.toHaveBeenCalled();
    expect(fixture.publishChanged).not.toHaveBeenCalled();
    expect(fixture.schedule).not.toHaveBeenCalled();
  });

  it("persists a chain receipt while broadcast is pending and preserves it after a late rejection", async () => {
    const fixture = createFixture();
    const broadcast = Promise.withResolvers<Hex.Hex>();
    fixture.broadcast.mockReturnValueOnce(broadcast.promise);

    const submitting = fixture.transactions.submit(prepared());
    await vi.waitFor(() => expect(fixture.broadcast).toHaveBeenCalledOnce());
    const { transactionId, hash } = committedRecord(fixture.commit);
    try {
      fixture.receipt.mockImplementation(async (requestedHash) =>
        requestedHash === hash
          ? {
              transactionHash: hash,
              blockHash: TRANSACTION_HASH,
              blockNumber: "0x2",
              transactionIndex: "0x0",
              gasUsed: "0x5208",
              contractAddress: null,
              status: "0x1",
            }
          : null,
      );
      const inspect = fixture.schedule.mock.lastCall?.[1];
      assert(inspect);
      inspect();
      await vi.waitFor(async () => {
        await expect(fixture.transactions.get(transactionId)).resolves.toMatchObject({
          state: { status: "confirmed" },
        });
      });
    } finally {
      broadcast.reject(new ChainJsonRpcResponseError({ rpcCode: -32000, message: "nonce too low" }));
    }

    const submission = await submitting;
    expect(submission).toMatchObject({
      transactionHash: hash,
      transaction: { state: { status: "confirmed" } },
    });
    await expect(fixture.transactions.get(transactionId)).resolves.toEqual(submission.transaction);
  });

  it("keeps a rejected cancellation as a separate failed record with its hash and replacement details", async () => {
    const fixture = createFixture(replacementTarget);
    const replacement = await fixture.transactions.prepareReplacement({
      transactionId: replacementTarget.transactionId,
      type: "cancel",
    });
    expect(replacement.transaction).toMatchObject({
      to: ADDRESS,
      value: "0x0",
      data: "0x",
      gas: "0x88b8",
      gasPrice: "0x30",
    });
    expect(replacement.transaction).not.toHaveProperty("nonce");
    expect(fixture.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "eth_estimateGas",
        params: [expect.objectContaining({ to: ADDRESS, value: "0x0", data: "0x", nonce: "0x1" })],
      }),
    );
    fixture.broadcast.mockRejectedValueOnce(
      new ChainJsonRpcResponseError({
        rpcCode: -32_000,
        message: "insufficient funds",
        data: { available: "0x0" },
      }),
    );

    const submission = await fixture.transactions.submit(replacement);
    const pending = committedRecord(fixture.commit);
    const failed = committedRecord(fixture.commit, 1);

    expect(pending.transactionId).not.toBe(replacementTarget.transactionId);
    expect(submission).toMatchObject({
      status: "failed",
      transaction: {
        transactionId: pending.transactionId,
        hash: pending.hash,
        replacesTransactionId: replacementTarget.transactionId,
        replacementType: "cancel",
        transaction: { nonce: replacementTarget.transaction.nonce },
        state: {
          status: "failed",
          failure: { type: "broadcast", code: -32_000, message: "insufficient funds", data: { available: "0x0" } },
        },
      },
    });
    expect(fixture.commit).toHaveBeenCalledTimes(2);
    expect(failed).not.toHaveProperty("recovery");
    expect(failed).toEqual(submission.transaction);
    await expect(fixture.transactions.get(pending.transactionId)).resolves.toEqual(submission.transaction);
  });

  it("retains the pending recovery artifact and monitoring when the broadcast outcome is unknown", async () => {
    const fixture = createFixture();
    fixture.broadcast.mockRejectedValueOnce(new ChainJsonRpcHttpTransportError("RPC connection lost."));
    const endpoints = fixture.networks.getRpcEndpoints(CHAIN_REF);
    expect(endpoints.length).toBeGreaterThan(1);

    const submission = await fixture.transactions.submit(prepared());

    const record = committedRecord(fixture.commit);
    expect(submission).toMatchObject({
      status: "pending",
      transactionHash: record.hash,
      transaction: { hash: record.hash, state: { status: "pending" } },
    });
    expect(fixture.commit).toHaveBeenCalledOnce();
    const broadcastEndpoints = fixture.request.mock.calls
      .map(([request]) => request)
      .filter(({ method }) => method === "eth_sendRawTransaction")
      .map(({ endpoint }) => endpoint);
    expect(broadcastEndpoints).toEqual([endpoints[0]]);
  });

  it("rechecks the member after nonce RPC completes and before signing", async () => {
    const fixture = createFixture();
    const nonce = Promise.withResolvers<string>();
    fixture.request.mockReturnValueOnce(nonce.promise);

    const submission = fixture.transactions.submit(prepared());
    await vi.waitFor(() => expect(fixture.request).toHaveBeenCalled());
    const removal = fixture.accounts.prepareRemoveSourceGroups(KEY_SOURCE_ID);
    assert(removal.update);
    removal.update.activate();
    nonce.resolve("0x1");

    await expect(submission).rejects.toMatchObject({ code: "account.not_found" });
    expect(fixture.signDigest).not.toHaveBeenCalled();
    expect(fixture.commit).not.toHaveBeenCalled();
    expect(fixture.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "eth_sendRawTransaction" }));
  });

  it("does not create or broadcast a record when the wallet locks before signing", async () => {
    const fixture = createFixture();
    fixture.signDigest.mockRejectedValueOnce(new WalletLockedError());

    await expect(fixture.transactions.submit(prepared())).rejects.toMatchObject({
      code: "eip155.transaction.signing_unavailable",
    });
    expect(fixture.commit).not.toHaveBeenCalled();
    expect(fixture.broadcast).not.toHaveBeenCalled();
  });

  it("rejects a replacement whose target was removed", async () => {
    const fixture = createFixture();

    await expect(fixture.transactions.submit(prepared(replacementTarget.transactionId))).rejects.toMatchObject({
      code: "transaction.not_found",
    });
    expect(fixture.signDigest).not.toHaveBeenCalled();
    expect(fixture.commit).not.toHaveBeenCalled();
  });

  it("rechecks pending replacements after a persistence read yields a stale snapshot", async () => {
    const fixture = createFixture(replacementTarget);
    const pendingRead = Promise.withResolvers<readonly PendingTransactionRecord[]>();
    fixture.listPending.mockReturnValueOnce(pendingRead.promise);

    const submission = fixture.transactions.submit(prepared(replacementTarget.transactionId));
    await vi.waitFor(() => expect(fixture.listPending).toHaveBeenCalled());
    fixture.listPending.mockResolvedValue([pendingReplacement]);
    pendingRead.resolve([]);

    await expect(submission).rejects.toMatchObject({
      code: "transaction.replacement_unavailable",
      details: { transactionId: replacementTarget.transactionId, status: "pending", reason: "has_pending_replacement" },
    });
    expect(fixture.signDigest).not.toHaveBeenCalled();
    expect(fixture.commit).not.toHaveBeenCalled();
    expect(fixture.broadcast).not.toHaveBeenCalled();
  });

  it("checks for delegated account code again before signing a cancellation", async () => {
    const fixture = createFixture(replacementTarget);
    const replacement = await fixture.transactions.prepareReplacement({
      transactionId: replacementTarget.transactionId,
      type: "cancel",
    });
    const respond = fixture.request.getMockImplementation();
    assert(respond);
    // A reorg replaced the transaction that used the preceding nonce with a delegation.
    fixture.request.mockClear();
    fixture.request.mockImplementation((input) =>
      input.method === "eth_getCode"
        ? Promise.resolve("0xef0100aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        : respond(input),
    );

    await expect(fixture.transactions.submit(replacement)).rejects.toMatchObject({
      code: "eip155.transaction.cancellation_unavailable",
      details: { reason: "account_has_code" },
    });
    expect(fixture.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "eth_getTransactionCount", params: [ADDRESS, BLOCK_NUMBER] }),
    );
    expect(fixture.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "eth_getCode", params: [ADDRESS, BLOCK_NUMBER] }),
    );
    expect(fixture.signDigest).not.toHaveBeenCalled();
    expect(fixture.commit).not.toHaveBeenCalled();
  });
});
