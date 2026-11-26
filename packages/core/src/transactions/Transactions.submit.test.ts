import { Hash, Hex } from "ox";
import { assert, describe, expect, it, vi } from "vitest";
import type { ChainJsonRpc, ChainJsonRpcRequest } from "../chainJsonRpc/ChainJsonRpc.js";
import { ChainJsonRpcOutcomeUnknownError, ChainJsonRpcResponseError } from "../chainJsonRpc/errors.js";
import {
  ACCOUNT_ID,
  ADDRESS,
  createAccounts,
  createNetworks,
  KEY_SOURCE_ID,
  PRIVATE_KEY,
} from "../namespaces/eip155/__tests__/fixtures.js";
import type { Eip155AccountSigning } from "../namespaces/eip155/accountSigning.js";
import { signEip155Digest } from "../namespaces/eip155/keyring.js";
import type { PersistenceWriter } from "../persistence/corePersistence.js";
import { PersistenceCommitError } from "../persistence/errors.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import { WalletLockedError } from "../wallet/errors.js";
import { createEip155TransactionsAdapter } from "./eip155/adapter.js";
import type { PendingTransactionRecord, TransactionsReader } from "./persistence.js";
import type { PreparedTransaction } from "./preparedTransaction.js";
import { createTransactions, type TransactionsChanged } from "./Transactions.js";
import type { Transaction, TransactionId } from "./types.js";

const CHAIN_REF = "eip155:1";
const TRANSACTION_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const prepared = (nonce?: `0x${string}`, replacesTransactionId?: TransactionId): PreparedTransaction => ({
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
    ...(nonce === undefined ? {} : { nonce }),
    type: "legacy",
    gasPrice: "0x1",
  },
});

const replacementTarget: Transaction = {
  ...prepared("0x1"),
  transactionId: "transaction-target",
  hash: TRANSACTION_HASH,
  transaction: { ...prepared("0x1").transaction, nonce: "0x1" },
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
  const request = vi.fn(async ({ method, params }: ChainJsonRpcRequest): Promise<unknown> => {
    if (method === "eth_getTransactionCount") return "0x1";
    if (method === "eth_sendRawTransaction") {
      assert(Array.isArray(params) && Hex.validate(params[0]));
      return Hash.keccak256(params[0]);
    }
    throw new Error(`Unexpected RPC method: ${method}`);
  });
  const chainJsonRpc: ChainJsonRpc = {
    request: async <TResult>(input: ChainJsonRpcRequest) => (await request(input)) as TResult,
  };
  const listPending = vi.fn<TransactionsReader["listPending"]>(async () => []);
  const reader: TransactionsReader = {
    get: async () => target,
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
    pendingTransactionsReader: reader,
    signing: { signDigest },
  });
  const commit = vi.fn<PersistenceWriter["commit"]>(async () => {});
  const publishChanged = vi.fn<(change: TransactionsChanged) => void>();
  const monitor = { track: vi.fn(), stop: vi.fn() };
  const transactions = createTransactions({
    readers: { transactions: reader },
    accounts,
    networks: createNetworks(),
    mutations: createCoreMutationQueue({ commit }),
    time: { now: () => 100 },
    adapters: { eip155: adapter },
    monitor,
    publishChanged,
  });

  return { transactions, accounts, commit, request, signDigest, listPending, monitor, publishChanged };
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
    fixture.commit.mockReturnValueOnce(persistence.promise);

    const pending = fixture.transactions.submit(prepared("0x1"));
    try {
      await vi.waitFor(() => expect(fixture.commit).toHaveBeenCalledOnce());
      const record = committedRecord(fixture.commit);
      assert(record.recovery);
      expect(record.hash).toBe(Hash.keccak256(record.recovery.rawTransaction));
      expect(fixture.request).not.toHaveBeenCalled();
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
    expect(fixture.request).toHaveBeenCalledWith({
      chainRef: CHAIN_REF,
      method: "eth_sendRawTransaction",
      params: [record.recovery.rawTransaction],
      replay: "forbidden",
    });
    expect(fixture.monitor.track).toHaveBeenCalledWith(record);
    expect(fixture.publishChanged).toHaveBeenCalledWith({
      type: "transactionsChanged",
      transactionIds: [submission.transaction.transactionId],
    });
  });

  it("does not broadcast or publish when the recovery commit fails", async () => {
    const fixture = createFixture();
    const failure = new PersistenceCommitError(new Error("IndexedDB transaction aborted"));
    fixture.commit.mockRejectedValueOnce(failure);

    await expect(fixture.transactions.submit(prepared("0x1"))).rejects.toBe(failure);
    expect(fixture.request).not.toHaveBeenCalled();
    expect(fixture.publishChanged).not.toHaveBeenCalled();
    expect(fixture.monitor.track).not.toHaveBeenCalled();
  });

  it("keeps a rejected cancellation as a separate failed record with its hash and replacement details", async () => {
    const fixture = createFixture(replacementTarget);
    const replacement = await fixture.transactions.prepareReplacement({
      transactionId: replacementTarget.transactionId,
      type: "cancel",
    });
    fixture.request.mockRejectedValueOnce(
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
    expect(fixture.monitor.stop).toHaveBeenCalledWith(submission.transaction.transactionId);
    expect(fixture.monitor.track).not.toHaveBeenCalled();
  });

  it("retains the pending recovery artifact and monitoring when the broadcast outcome is unknown", async () => {
    const fixture = createFixture();
    fixture.request.mockRejectedValueOnce(new ChainJsonRpcOutcomeUnknownError());

    const submission = await fixture.transactions.submit(prepared("0x1"));

    const record = committedRecord(fixture.commit);
    expect(submission).toMatchObject({
      status: "pending",
      transactionHash: record.hash,
      transaction: { hash: record.hash, state: { status: "pending" } },
    });
    expect(fixture.commit).toHaveBeenCalledOnce();
    expect(fixture.monitor.track).toHaveBeenCalledWith(record);
    expect(fixture.monitor.stop).not.toHaveBeenCalled();
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

    await expect(fixture.transactions.submit(prepared("0x1"))).rejects.toMatchObject({
      code: "eip155.transaction.signing_unavailable",
    });
    expect(fixture.commit).not.toHaveBeenCalled();
    expect(fixture.request).not.toHaveBeenCalled();
  });

  it("rejects a replacement whose target was removed", async () => {
    const fixture = createFixture();

    await expect(fixture.transactions.submit(prepared("0x1", replacementTarget.transactionId))).rejects.toMatchObject({
      code: "transaction.not_found",
    });
    expect(fixture.signDigest).not.toHaveBeenCalled();
    expect(fixture.commit).not.toHaveBeenCalled();
  });

  it("rechecks pending replacements after a persistence read yields a stale snapshot", async () => {
    const fixture = createFixture(replacementTarget);
    const pendingRead = Promise.withResolvers<readonly PendingTransactionRecord[]>();
    fixture.listPending.mockReturnValueOnce(pendingRead.promise);

    const submission = fixture.transactions.submit(prepared("0x1", replacementTarget.transactionId));
    await vi.waitFor(() => expect(fixture.listPending).toHaveBeenCalled());
    fixture.listPending.mockResolvedValue([pendingReplacement]);
    pendingRead.resolve([]);

    await expect(submission).rejects.toMatchObject({
      code: "transaction.replacement_unavailable",
      details: { transactionId: replacementTarget.transactionId, status: "pending", reason: "has_pending_replacement" },
    });
    expect(fixture.signDigest).not.toHaveBeenCalled();
    expect(fixture.commit).not.toHaveBeenCalled();
    expect(fixture.request).not.toHaveBeenCalled();
  });
});
