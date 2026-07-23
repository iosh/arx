import { describe, expect, it, vi } from "vitest";
import type { Accounts } from "../accounts/Accounts.js";
import type { Account, AccountAddress } from "../accounts/types.js";
import type { Network, NetworksReader } from "../networks/types.js";
import type { Eip155TransactionPreparer } from "./eip155/prepareTransaction.js";
import type { PendingTransactionRecord } from "./persistence.js";
import { createTransactions } from "./Transactions.js";
import { loadTransactionsBootstrap } from "./transactionBootstrap.js";
import type { Transaction } from "./types.js";

const account: Account = {
  accountId: "eip155:0000000000000000000000000000000000000001",
  namespace: "eip155",
  origin: { type: "private-key", keySourceId: "key-source-1" },
  hidden: false,
  selected: true,
  createdAt: 1,
};

const address: AccountAddress = {
  accountId: account.accountId,
  chainRef: "eip155:1",
  canonicalAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  displayAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

const network: Network = {
  chainRef: "eip155:1",
  namespace: "eip155",
  source: "builtin",
  name: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

const preparedTransaction = {
  from: address.canonicalAddress,
  to: null,
  value: "0x0",
  data: "0x",
  gas: "0x5208",
  fee: { type: "legacy", gasPrice: "0x1" },
} as const;

const createDependencies = (input?: { account?: Account | null; network?: ReturnType<NetworksReader["get"]> }) => {
  const accounts = {
    getAccount: vi.fn(() => (input?.account === undefined ? account : input.account)),
    getAddress: vi.fn(() => address),
  } satisfies Pick<Accounts, "getAccount" | "getAddress">;
  const networks = {
    get: vi.fn(() => (input?.network === undefined ? network : input.network)),
  } satisfies Pick<NetworksReader, "get">;
  const prepareEip155Transaction = vi.fn(async () => preparedTransaction) satisfies Eip155TransactionPreparer;

  return { accounts, networks, prepareEip155Transaction };
};

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
    const transactions = createTransactions({ readers, ...createDependencies() });

    await expect(transactions.get(transaction.transactionId)).resolves.toEqual(transaction);
    await expect(transactions.list({ limit: 20 })).resolves.toEqual({ transactions: [transaction] });
    expect(readers.transactions.get).toHaveBeenCalledWith(transaction.transactionId);
    expect(readers.transactions.list).toHaveBeenCalledWith({ limit: 20 });
  });

  it("prepares with the registered account, network, and projected address", async () => {
    const readers = {
      transactions: {
        get: vi.fn(async () => null),
        list: vi.fn(async () => ({ transactions: [] })),
        listPending: vi.fn(async () => []),
      },
    };
    const dependencies = createDependencies();
    const transactions = createTransactions({ readers, ...dependencies });
    const input = {
      namespace: "eip155" as const,
      chainRef: "eip155:1",
      accountId: account.accountId,
      initiator: { type: "wallet" as const },
      transaction: { gas: "0x5208" },
    };

    await expect(transactions.prepare(input)).resolves.toEqual({
      namespace: "eip155",
      chainRef: "eip155:1",
      accountId: account.accountId,
      initiator: { type: "wallet" },
      transaction: preparedTransaction,
    });
    expect(dependencies.accounts.getAddress).toHaveBeenCalledWith({
      chainRef: input.chainRef,
      accountId: input.accountId,
    });
    expect(dependencies.prepareEip155Transaction).toHaveBeenCalledWith({
      chainRef: input.chainRef,
      from: address.canonicalAddress,
      transaction: input.transaction,
    });
  });

  it("rejects a missing account or network before calling the EIP-155 leaf", async () => {
    const readers = {
      transactions: {
        get: vi.fn(async () => null),
        list: vi.fn(async () => ({ transactions: [] })),
        listPending: vi.fn(async () => []),
      },
    };
    const missingAccount = createDependencies({ account: null });
    const missingAccountTransactions = createTransactions({ readers, ...missingAccount });
    const input = {
      namespace: "eip155" as const,
      chainRef: "eip155:1",
      accountId: account.accountId,
      initiator: { type: "wallet" as const },
      transaction: { gas: "0x5208" },
    };

    await expect(missingAccountTransactions.prepare(input)).rejects.toMatchObject({ code: "account.not_found" });
    expect(missingAccount.prepareEip155Transaction).not.toHaveBeenCalled();

    const missingNetwork = createDependencies({ network: null });
    const missingNetworkTransactions = createTransactions({ readers, ...missingNetwork });

    await expect(missingNetworkTransactions.prepare(input)).rejects.toMatchObject({ code: "network.not_found" });
    expect(missingNetwork.prepareEip155Transaction).not.toHaveBeenCalled();
  });

  it("loads pending records for the later monitor bootstrap", async () => {
    const listPending = vi.fn(async () => [pendingRecord]);

    await expect(loadTransactionsBootstrap({ transactions: { listPending } })).resolves.toEqual({
      pendingTransactions: [pendingRecord],
    });
    expect(listPending).toHaveBeenCalledOnce();
  });
});
