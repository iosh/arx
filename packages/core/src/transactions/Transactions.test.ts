import { describe, expect, it, vi } from "vitest";
import type { ChainJsonRpc, ChainJsonRpcRequest } from "../chainJsonRpc/ChainJsonRpc.js";
import { ACCOUNT_ID, ADDRESS, createAccounts, createNetworks } from "../namespaces/eip155/__tests__/fixtures.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import { createEip155TransactionsAdapter } from "./eip155/adapter.js";
import type { PendingTransactionRecord, TransactionsReader } from "./persistence.js";
import type { PrepareTransactionInput } from "./preparedTransaction.js";
import { createTransactions } from "./Transactions.js";
import type { Transaction } from "./types.js";

const CHAIN_REF = "eip155:1";
const input: PrepareTransactionInput = {
  namespace: "eip155",
  chainRef: CHAIN_REF,
  accountId: ACCOUNT_ID,
  initiator: { type: "wallet" },
  transaction: { type: "auto", gas: "0x5208" },
};

const target: Transaction = {
  transactionId: "transaction-1",
  namespace: "eip155",
  chainRef: CHAIN_REF,
  accountId: ACCOUNT_ID,
  initiator: { type: "dapp", origin: "https://example.com" },
  transaction: {
    from: ADDRESS,
    to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    value: "0x0",
    data: "0x",
    gas: "0x5208",
    nonce: "0x1",
    type: "legacy",
    gasPrice: "0x1",
  },
  state: { status: "pending" },
  createdAt: 1,
  updatedAt: 1,
};

const pendingReplacement: PendingTransactionRecord = {
  ...target,
  transactionId: "transaction-2",
  replacesTransactionId: target.transactionId,
  state: { status: "pending" },
  recovery: { rawTransaction: "0xcafebabe" },
};

const createFixture = (transaction: Transaction | null = null, pending: readonly PendingTransactionRecord[] = []) => {
  const request = vi.fn(async ({ method }: ChainJsonRpcRequest): Promise<unknown> => {
    if (method === "eth_getBlockByNumber") return {};
    if (method === "eth_gasPrice") return "0x1";
    throw new Error(`Unexpected RPC method: ${method}`);
  });
  const chainJsonRpc: ChainJsonRpc = {
    request: async <TResult>(input: ChainJsonRpcRequest) => (await request(input)) as TResult,
  };
  const reader: TransactionsReader = {
    get: async () => transaction,
    list: async () => ({ transactions: [] }),
    listPending: async () => pending,
  };
  const adapter = createEip155TransactionsAdapter({
    chainJsonRpc,
    pendingTransactionsReader: reader,
    signing: {
      signDigest: async () => {
        throw new Error("Unexpected transaction signature.");
      },
    },
  });
  const transactions = createTransactions({
    readers: { transactions: reader },
    accounts: createAccounts(),
    networks: createNetworks(),
    adapters: { eip155: adapter },
    mutations: createCoreMutationQueue({ commit: async () => {} }),
    time: { now: () => 1 },
    monitor: { track: () => {}, stop: () => {} },
    publishChanged: () => {},
  });

  return { transactions, request };
};

describe("Transactions", () => {
  it("prepares the requested member independently of the selected wallet group", async () => {
    const { transactions } = createFixture();

    await expect(transactions.prepare(input)).resolves.toEqual({
      ...input,
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
  });

  it.each([
    {
      missing: "member",
      request: { ...input, accountId: "eip155:0000000000000000000000000000000000000004" },
      code: "account.not_found",
    },
    {
      missing: "network",
      request: { ...input, chainRef: "eip155:999999" },
      code: "network.not_found",
    },
  ])("rejects a removed $missing before requesting RPC", async (testCase) => {
    const { transactions, request } = createFixture();

    await expect(transactions.prepare(testCase.request)).rejects.toMatchObject({ code: testCase.code });
    expect(request).not.toHaveBeenCalled();
  });

  it("prepares a wallet replacement using the original transaction's member and chain", async () => {
    const { transactions } = createFixture(target);

    await expect(
      transactions.prepareReplacement({ transactionId: target.transactionId, type: "speed-up" }),
    ).resolves.toMatchObject({
      namespace: "eip155",
      chainRef: target.chainRef,
      accountId: target.accountId,
      initiator: { type: "wallet" },
      replacesTransactionId: target.transactionId,
      transaction: {
        from: ADDRESS,
        to: target.transaction.to,
        nonce: target.transaction.nonce,
      },
    });
  });

  it.each([
    { reason: "removed", target: null, pending: [], code: "transaction.not_found" },
    {
      reason: "terminal",
      target: {
        ...target,
        state: { status: "replaced", replacement: { type: "external" } },
      } satisfies Transaction,
      pending: [],
      code: "transaction.replacement_unavailable",
    },
    {
      reason: "already being replaced",
      target,
      pending: [pendingReplacement],
      code: "transaction.replacement_unavailable",
    },
  ])("rejects replacement preparation when the target is $reason", async (testCase) => {
    const { transactions, request } = createFixture(testCase.target, testCase.pending);

    await expect(
      transactions.prepareReplacement({ transactionId: target.transactionId, type: "cancel" }),
    ).rejects.toMatchObject({ code: testCase.code });
    expect(request).not.toHaveBeenCalled();
  });
});
