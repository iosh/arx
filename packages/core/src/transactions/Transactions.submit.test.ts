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
import { signEip155PrivateKeyDigest } from "../namespaces/eip155/keyring.js";
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
  ...(replacesTransactionId === undefined ? {} : { replacesTransactionId }),
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
  transaction: { ...prepared("0x1").transaction, nonce: "0x1" },
  state: { status: "pending" },
  createdAt: 1,
  updatedAt: 1,
};

const pendingReplacement: PendingTransactionRecord = {
  ...replacementTarget,
  transactionId: "transaction-replacement",
  replacesTransactionId: replacementTarget.transactionId,
  state: { status: "pending" },
  recovery: { rawTransaction: "0xcafebabe" },
};

const createFixture = (target: Transaction | null = null) => {
  const accounts = createAccounts();
  const request = vi.fn(async ({ method }: ChainJsonRpcRequest): Promise<unknown> => {
    if (method === "eth_getTransactionCount") return "0x1";
    if (method === "eth_sendRawTransaction") return TRANSACTION_HASH;
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
  const signDigest = vi.fn<Eip155AccountSigning["signDigest"]>(async (input) =>
    signEip155PrivateKeyDigest({ ...input, privateKey: PRIVATE_KEY }),
  );
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
  const change = commit.mock.calls[call]?.[0][0];
  assert(change?.persistenceType === "transaction" && change.operation === "put");
  return change.value;
};

describe("Transactions.submit", () => {
  it("waits for the recovery artifact commit before broadcasting those exact bytes", async () => {
    const fixture = createFixture();
    const persistence = Promise.withResolvers<void>();
    fixture.commit.mockReturnValueOnce(persistence.promise);

    const pending = fixture.transactions.submit(prepared("0x1"));
    try {
      await vi.waitFor(() => expect(fixture.commit).toHaveBeenCalledOnce());
      expect(fixture.request).not.toHaveBeenCalled();
      expect(fixture.publishChanged).not.toHaveBeenCalled();
    } finally {
      persistence.resolve();
    }
    const submission = await pending;

    expect(submission).toMatchObject({
      status: "pending",
      transactionHash: TRANSACTION_HASH,
      transaction: { chainRef: CHAIN_REF, accountId: ACCOUNT_ID, state: { status: "pending" } },
    });
    expect(submission.transaction).not.toHaveProperty("recovery");
    const record = committedRecord(fixture.commit);
    assert(record.recovery);
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

  it("persists an explicit broadcast rejection as failed and removes recovery material", async () => {
    const fixture = createFixture();
    fixture.request.mockRejectedValueOnce(
      new ChainJsonRpcResponseError({
        rpcCode: -32_000,
        message: "insufficient funds",
        data: { available: "0x0" },
      }),
    );

    const submission = await fixture.transactions.submit(prepared("0x1"));

    expect(submission).toMatchObject({
      status: "failed",
      transaction: {
        state: {
          status: "failed",
          failure: { type: "broadcast", code: -32_000, message: "insufficient funds", data: { available: "0x0" } },
        },
      },
    });
    expect(fixture.commit).toHaveBeenCalledTimes(2);
    expect(committedRecord(fixture.commit, 1)).toEqual(submission.transaction);
    expect(fixture.monitor.stop).toHaveBeenCalledWith(submission.transaction.transactionId);
    expect(fixture.monitor.track).not.toHaveBeenCalled();
  });

  it("retains the pending recovery artifact and monitoring when the broadcast outcome is unknown", async () => {
    const fixture = createFixture();
    fixture.request.mockRejectedValueOnce(new ChainJsonRpcOutcomeUnknownError());

    const submission = await fixture.transactions.submit(prepared("0x1"));

    expect(submission).toMatchObject({ status: "pending", transaction: { state: { status: "pending" } } });
    expect(fixture.commit).toHaveBeenCalledOnce();
    expect(fixture.monitor.track).toHaveBeenCalledWith(committedRecord(fixture.commit));
    expect(fixture.monitor.stop).not.toHaveBeenCalled();
  });

  it("rechecks the member after nonce RPC completes and before signing", async () => {
    const fixture = createFixture();
    const nonce = Promise.withResolvers<string>();
    fixture.request.mockReturnValueOnce(nonce.promise);

    const submission = fixture.transactions.submit(prepared());
    await vi.waitFor(() => expect(fixture.request).toHaveBeenCalled());
    const removal = fixture.accounts.prepareRemoveSourceGroups(KEY_SOURCE_ID);
    assert(removal);
    fixture.accounts.applyCommittedUpdate(removal);
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
