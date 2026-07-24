import { describe, expect, it, vi } from "vitest";
import type { Accounts } from "../accounts/Accounts.js";
import type { Account, AccountAddress } from "../accounts/types.js";
import type { Network, NetworksReader } from "../networks/types.js";
import type { TransactionsNamespaceAdapter, TransactionsNamespaceAdapters } from "./namespaceAdapter.js";
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

const unexpectedTransactionSubmission = (): never => {
  throw new Error("Unexpected transaction submission.");
};

const createDependencies = (input?: {
  account?: Account | null;
  network?: ReturnType<NetworksReader["get"]>;
  adapters?: TransactionsNamespaceAdapters;
}) => {
  const accounts = {
    getAccount: vi.fn(() => (input?.account === undefined ? account : input.account)),
    getAddress: vi.fn(() => address),
  } satisfies Pick<Accounts, "getAccount" | "getAddress">;
  const networks = {
    get: vi.fn(() => (input?.network === undefined ? network : input.network)),
  } satisfies Pick<NetworksReader, "get">;
  const adapter = {
    namespace: "eip155",
    prepare: vi.fn(async ({ request }) => ({ ...request, transaction: preparedTransaction })),
    createSigningInput: async () => unexpectedTransactionSubmission(),
    sign: async () => unexpectedTransactionSubmission(),
    broadcast: async () => unexpectedTransactionSubmission(),
    createSubmission: unexpectedTransactionSubmission,
    inspectPending: async () => unexpectedTransactionSubmission(),
    recoverPending: async () => unexpectedTransactionSubmission(),
  } satisfies TransactionsNamespaceAdapter;
  const adapters = input?.adapters ?? ({ eip155: adapter } satisfies TransactionsNamespaceAdapters);

  return { accounts, networks, adapters, prepare: adapter.prepare };
};

const transaction: Transaction = {
  transactionId: "transaction-1",
  namespace: "eip155",
  chainRef: "eip155:1",
  accountId: "eip155:0000000000000000000000000000000000000001",
  initiator: { type: "wallet" },
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
    expect(dependencies.prepare).toHaveBeenCalledWith({
      request: input,
      from: address.canonicalAddress,
    });
  });

  it("rejects a missing account or network before calling the transaction adapter", async () => {
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
    expect(missingAccount.prepare).not.toHaveBeenCalled();

    const missingNetwork = createDependencies({ network: null });
    const missingNetworkTransactions = createTransactions({ readers, ...missingNetwork });

    await expect(missingNetworkTransactions.prepare(input)).rejects.toMatchObject({ code: "network.not_found" });
    expect(missingNetwork.prepare).not.toHaveBeenCalled();
  });

  it("rejects an unsupported transaction namespace", async () => {
    const readers = {
      transactions: {
        get: vi.fn(async () => null),
        list: vi.fn(async () => ({ transactions: [] })),
        listPending: vi.fn(async () => []),
      },
    };
    const dependencies = createDependencies({ adapters: {} });
    const transactions = createTransactions({ readers, ...dependencies });

    await expect(
      transactions.prepare({
        namespace: "eip155",
        chainRef: "eip155:1",
        accountId: account.accountId,
        initiator: { type: "wallet" },
        transaction: { gas: "0x5208" },
      }),
    ).rejects.toMatchObject({ code: "transaction.namespace_unsupported" });
    expect(dependencies.accounts.getAccount).not.toHaveBeenCalled();
  });

  it("loads pending records for the later monitor bootstrap", async () => {
    const listPending = vi.fn(async () => [pendingRecord]);

    await expect(loadTransactionsBootstrap({ transactions: { listPending } })).resolves.toEqual({
      pendingTransactions: [pendingRecord],
    });
    expect(listPending).toHaveBeenCalledOnce();
  });
});
