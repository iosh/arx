import { describe, expect, it, vi } from "vitest";
import type { PendingTransactionRecord } from "./persistence.js";
import { createTransactions } from "./Transactions.js";
import { loadTransactionsBootstrap } from "./transactionBootstrap.js";
import type { Transaction } from "./types.js";

const transaction: Transaction = {
  transactionId: "transaction-1",
  namespace: "eip155",
  chainRef: "eip155:1",
  accountId: "eip155:0000000000000000000000000000000000000001",
  initiator: { type: "wallet" },
  networkTransactionId: "0xtransaction-1",
  transaction: {
    from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    value: "0x0",
    data: "0x",
    gas: "0x5208",
    nonce: "0x1",
    fee: { type: "legacy", gasPrice: "0x1" },
  },
  state: { status: "pending" },
  createdAt: 1,
  updatedAt: 1,
};

const pendingRecord: PendingTransactionRecord = {
  ...transaction,
  recovery: { rawTransaction: "0xdeadbeef" },
};

describe("Transactions", () => {
  it("delegates record queries to the persistence reader", async () => {
    const readers = {
      transactions: {
        get: vi.fn(async () => transaction),
        list: vi.fn(async () => ({ transactions: [transaction] })),
        listPending: vi.fn(async () => [pendingRecord]),
      },
    };
    const transactions = createTransactions({ readers });

    await expect(transactions.get(transaction.transactionId)).resolves.toEqual(transaction);
    await expect(transactions.list({ limit: 20 })).resolves.toEqual({ transactions: [transaction] });
    expect(readers.transactions.get).toHaveBeenCalledWith(transaction.transactionId);
    expect(readers.transactions.list).toHaveBeenCalledWith({ limit: 20 });
  });

  it("loads pending records for the later monitor bootstrap", async () => {
    const listPending = vi.fn(async () => [pendingRecord]);

    await expect(loadTransactionsBootstrap({ transactions: { listPending } })).resolves.toEqual({
      pendingTransactions: [pendingRecord],
    });
    expect(listPending).toHaveBeenCalledOnce();
  });
});
