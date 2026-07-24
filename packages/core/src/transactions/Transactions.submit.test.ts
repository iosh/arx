import { describe, expect, it, vi } from "vitest";
import type { Accounts } from "../accounts/Accounts.js";
import type { Account, AccountAddress } from "../accounts/types.js";
import type { ChainRef } from "../networks/chainRef.js";
import type { Network, NetworksReader } from "../networks/types.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { CoreTime } from "../runtime/time.js";
import type { TransactionsNamespaceAdapter } from "./namespaceAdapter.js";
import type { PendingTransactionRecord } from "./persistence.js";
import type { PreparedTransaction } from "./preparedTransaction.js";
import { createTransactions } from "./Transactions.js";
import type { TransactionBroadcastOutcome } from "./types.js";

const ACCOUNT_ID = "eip155:0000000000000000000000000000000000000001";
const CHAIN_REF: ChainRef = "eip155:1";
const FROM = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TRANSACTION_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

const account: Account = {
  accountId: ACCOUNT_ID,
  namespace: "eip155",
  origin: { type: "private-key", keySourceId: "key-source-1" },
  hidden: false,
  selected: true,
  createdAt: 1,
};

const address: AccountAddress = {
  accountId: ACCOUNT_ID,
  chainRef: CHAIN_REF,
  canonicalAddress: FROM,
  displayAddress: FROM,
};

const network: Network = {
  chainRef: CHAIN_REF,
  namespace: "eip155",
  source: "builtin",
  name: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

const prepared = (nonce?: `0x${string}`): PreparedTransaction => ({
  namespace: "eip155",
  chainRef: CHAIN_REF,
  accountId: ACCOUNT_ID,
  initiator: { type: "wallet" },
  transaction: {
    from: FROM,
    to: null,
    value: "0x0",
    data: "0x",
    gas: "0x5208",
    ...(nonce === undefined ? {} : { nonce }),
    fee: { type: "legacy", gasPrice: "0x1" },
  },
});

type FixtureOptions = Readonly<{
  broadcast?: TransactionBroadcastOutcome;
  pauseBeforeSigningInput?: () => Promise<void>;
  signingError?: Error;
}>;

const createFixture = (input: FixtureOptions = {}) => {
  let currentAccount: Account | null = account;
  const order: string[] = [];
  const accounts = {
    getAccount: vi.fn(() => currentAccount),
    getAddress: vi.fn(() => address),
  } satisfies Pick<Accounts, "getAccount" | "getAddress">;
  const networks = {
    get: vi.fn(() => network),
  } satisfies Pick<NetworksReader, "get">;
  type SigningInputRequest = Parameters<TransactionsNamespaceAdapter["createSigningInput"]>[0];
  type SigningInput = Awaited<ReturnType<TransactionsNamespaceAdapter["createSigningInput"]>>;
  type SignedTransaction = Awaited<ReturnType<TransactionsNamespaceAdapter["sign"]>>;
  const createSigningInput = vi.fn(async (params: SigningInputRequest): Promise<SigningInput> => {
    await input.pauseBeforeSigningInput?.();

    return {
      chainRef: params.chainRef,
      accountId: params.accountId,
      transaction: { ...params.transaction, nonce: params.transaction.nonce ?? "0x1" },
    };
  });
  const sign = vi.fn(async (signingInput: SigningInput): Promise<SignedTransaction> => {
    if (input.signingError) throw input.signingError;

    return {
      chainRef: signingInput.chainRef,
      transaction: signingInput.transaction,
      recovery: { rawTransaction: "0xdeadbeef" },
    };
  });
  const broadcast = vi.fn(async (): Promise<TransactionBroadcastOutcome> => {
    order.push("broadcast");
    return input.broadcast ?? { status: "accepted", transactionHash: TRANSACTION_HASH };
  });
  const createSubmission = vi.fn(
    ({
      transaction,
      broadcast: submissionBroadcast,
    }: Parameters<TransactionsNamespaceAdapter["createSubmission"]>[0]) =>
      submissionBroadcast.status === "rejected"
        ? { status: "failed" as const, transaction }
        : { status: "pending" as const, transaction, transactionHash: submissionBroadcast.transactionHash },
  );
  const adapter = {
    namespace: "eip155",
    prepare: async () => {
      throw new Error("Unexpected transaction preparation.");
    },
    createSigningInput,
    sign,
    broadcast,
    createSubmission,
    inspectPending: async () => ({ status: "pending" as const }),
    recoverPending: async () => ({ status: "pending" as const }),
  } satisfies TransactionsNamespaceAdapter;
  const commit = vi.fn(async () => {
    order.push("commit");
  });
  const mutations = createCoreMutationQueue({ commit });
  const time = {
    now: vi.fn(() => 100),
    schedule: () => () => {},
  } satisfies CoreTime;
  const publishChanged = vi.fn(() => {
    order.push("publish");
  });
  const startMonitoring = vi.fn(() => {
    order.push("start monitoring");
  });
  const monitor = {
    track: vi.fn(() => {
      order.push("track");
      return startMonitoring;
    }),
    stop: vi.fn(() => {
      order.push("stop");
    }),
  };
  const transactions = createTransactions({
    readers: {
      transactions: {
        get: vi.fn(async () => null),
        list: vi.fn(async () => ({ transactions: [] })),
        listPending: vi.fn(async () => []),
      },
    },
    accounts,
    networks,
    mutations,
    time,
    adapters: { eip155: adapter },
    monitor,
    publishChanged,
  });

  return {
    transactions,
    commit,
    createSigningInput,
    sign,
    broadcast,
    monitor,
    startMonitoring,
    publishChanged,
    order,
    setAccount: (value: Account | null) => {
      currentAccount = value;
    },
  };
};

const committedRecord = (commit: ReturnType<typeof vi.fn>, call = 0): PendingTransactionRecord =>
  commit.mock.calls[call]?.[0]?.[0]?.value as PendingTransactionRecord;

describe("Transactions.submit", () => {
  it("commits the recovery artifact before the first broadcast", async () => {
    const fixture = createFixture();

    const submission = await fixture.transactions.submit(prepared("0x1"));

    expect(submission).toMatchObject({
      status: "pending",
      transactionHash: TRANSACTION_HASH,
      transaction: {
        chainRef: CHAIN_REF,
        accountId: ACCOUNT_ID,
        state: { status: "pending" },
      },
    });
    expect(submission.transaction).not.toHaveProperty("recovery");
    expect(committedRecord(fixture.commit)).toMatchObject({
      state: { status: "pending" },
      recovery: { rawTransaction: "0xdeadbeef" },
    });
    expect(fixture.order).toEqual(["commit", "track", "publish", "broadcast", "start monitoring"]);
    expect(fixture.publishChanged).toHaveBeenCalledWith({
      type: "transactionsChanged",
      transactionIds: [submission.transaction.transactionId],
    });
  });

  it("persists an explicit broadcast rejection as failed", async () => {
    const fixture = createFixture({
      broadcast: {
        status: "rejected",
        failure: {
          type: "broadcast",
          code: -32_000,
          message: "insufficient funds",
          data: { available: "0x0" },
        },
      },
    });

    const submission = await fixture.transactions.submit(prepared("0x1"));

    expect(submission).toMatchObject({
      status: "failed",
      transaction: {
        state: {
          status: "failed",
          failure: {
            type: "broadcast",
            code: -32_000,
            message: "insufficient funds",
            data: { available: "0x0" },
          },
        },
      },
    });
    expect(fixture.commit).toHaveBeenCalledTimes(2);
    expect(committedRecord(fixture.commit, 1)).not.toHaveProperty("recovery");
    expect(fixture.order).toEqual(["commit", "track", "publish", "broadcast", "commit", "stop", "publish"]);
  });

  it("keeps the record pending when the broadcast outcome is unknown", async () => {
    const fixture = createFixture({
      broadcast: { status: "unknown", transactionHash: TRANSACTION_HASH },
    });

    const submission = await fixture.transactions.submit(prepared("0x1"));

    expect(submission).toMatchObject({ status: "pending", transactionHash: TRANSACTION_HASH });
    expect(fixture.commit).toHaveBeenCalledOnce();
    expect(fixture.publishChanged).toHaveBeenCalledOnce();
  });

  it("rechecks the account after nonce lookup and before signing", async () => {
    let releaseSigningInput!: () => void;
    const signingInputPaused = new Promise<void>((resolve) => {
      releaseSigningInput = resolve;
    });
    let notifySigningInputStarted!: () => void;
    const signingInputStarted = new Promise<void>((resolve) => {
      notifySigningInputStarted = resolve;
    });
    const fixture = createFixture({
      pauseBeforeSigningInput: async () => {
        notifySigningInputStarted();
        await signingInputPaused;
      },
    });

    const submission = fixture.transactions.submit(prepared());
    await signingInputStarted;
    fixture.setAccount(null);
    releaseSigningInput();

    await expect(submission).rejects.toMatchObject({ code: "account.not_found" });
    expect(fixture.commit).not.toHaveBeenCalled();
    expect(fixture.sign).not.toHaveBeenCalled();
    expect(fixture.broadcast).not.toHaveBeenCalled();
  });

  it("does not create a record when signing fails", async () => {
    const fixture = createFixture({ signingError: new Error("Signing failed.") });

    await expect(fixture.transactions.submit(prepared("0x1"))).rejects.toThrow("Signing failed.");
    expect(fixture.commit).not.toHaveBeenCalled();
    expect(fixture.broadcast).not.toHaveBeenCalled();
  });
});
