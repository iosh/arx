import type { Accounts } from "../accounts/Accounts.js";
import { AccountNotFoundError } from "../accounts/errors.js";
import { NetworkNotFoundError } from "../networks/errors.js";
import type { NetworksReader } from "../networks/types.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { CoreTime } from "../runtime/time.js";
import { TransactionNotFoundError, TransactionReplacementUnavailableError } from "./errors.js";
import type { TransactionsNamespaceAdapters } from "./namespaceAdapter.js";
import {
  type PendingTransactionRecord,
  type TransactionRecord,
  type TransactionsReader,
  transactionWrites,
} from "./persistence.js";
import type { PreparedTransaction, PrepareTransactionInput } from "./preparedTransaction.js";
import type {
  Transaction,
  TransactionId,
  TransactionPage,
  TransactionQuery,
  TransactionReplacementType,
  TransactionSubmission,
} from "./types.js";

export type TransactionsChanged = Readonly<{
  type: "transactionsChanged";
  transactionIds: readonly TransactionId[];
}>;

export type Transactions = Readonly<{
  prepare(input: PrepareTransactionInput): Promise<PreparedTransaction>;
  submit(prepared: PreparedTransaction): Promise<TransactionSubmission>;
  prepareReplacement(input: {
    transactionId: TransactionId;
    type: TransactionReplacementType;
  }): Promise<PreparedTransaction>;
  get(transactionId: TransactionId): Promise<Transaction | null>;
  list(query: TransactionQuery): Promise<TransactionPage>;
}>;

type TransactionsOptions = Readonly<{
  readers: Readonly<{
    transactions: Pick<TransactionsReader, "get" | "list" | "listPending">;
  }>;
  accounts: Pick<Accounts, "getAccount" | "getAddress">;
  networks: Pick<NetworksReader, "get">;
  mutations: CoreMutationQueue;
  time: Pick<CoreTime, "now">;
  adapters: TransactionsNamespaceAdapters;
  monitor: Readonly<{
    track(record: PendingTransactionRecord): void;
    untrack(transactionId: TransactionId): void;
  }>;
  publishChanged(change: TransactionsChanged): void;
}>;

export const createTransactions = (params: TransactionsOptions): Transactions => ({
  async prepare(input) {
    const adapter = params.adapters[input.namespace];
    if (!params.accounts.getAccount(input.accountId)) throw new AccountNotFoundError(input.accountId);
    if (!params.networks.get(input.chainRef)) throw new NetworkNotFoundError(input.chainRef);

    const { canonicalAddress } = params.accounts.getAddress({
      chainRef: input.chainRef,
      accountId: input.accountId,
    });
    return adapter.prepare({ request: input, from: canonicalAddress });
  },

  async prepareReplacement(input) {
    const target = await readReplaceableTransaction(params.readers.transactions, input.transactionId);

    const adapter = params.adapters[target.namespace];
    if (!params.accounts.getAccount(target.accountId)) throw new AccountNotFoundError(target.accountId);
    if (!params.networks.get(target.chainRef)) throw new NetworkNotFoundError(target.chainRef);

    const prepared = await adapter.prepareReplacement({
      target,
      type: input.type,
    });

    return {
      ...prepared,
      initiator: { type: "wallet" },
      replacesTransactionId: target.transactionId,
      replacementType: input.type,
    };
  },

  async submit(prepared) {
    const adapter = params.adapters[prepared.namespace];

    // Recheck before and after RPC-backed preparation because these prerequisites may change while it awaits.
    if (!params.accounts.getAccount(prepared.accountId)) throw new AccountNotFoundError(prepared.accountId);
    if (!params.networks.get(prepared.chainRef)) throw new NetworkNotFoundError(prepared.chainRef);
    const replacement =
      prepared.replacesTransactionId === undefined
        ? undefined
        : {
            target: await readReplaceableTransaction(params.readers.transactions, prepared.replacesTransactionId),
            type: prepared.replacementType,
          };

    const { transactionId, signed } = await adapter.withSigningInput(
      prepared,
      (signingInput) =>
        params.mutations.run(async (commit) => {
          if (!params.accounts.getAccount(prepared.accountId)) throw new AccountNotFoundError(prepared.accountId);
          if (!params.networks.get(prepared.chainRef)) throw new NetworkNotFoundError(prepared.chainRef);
          if (replacement) {
            await readReplaceableTransaction(params.readers.transactions, replacement.target.transactionId);
          }

          const signed = await adapter.sign(signingInput);
          const now = params.time.now();
          const record: PendingTransactionRecord = {
            transactionId: globalThis.crypto.randomUUID(),
            namespace: prepared.namespace,
            chainRef: prepared.chainRef,
            accountId: prepared.accountId,
            initiator: prepared.initiator,
            ...(replacement
              ? { replacesTransactionId: replacement.target.transactionId, replacementType: replacement.type }
              : {}),
            hash: signed.hash,
            transaction: signed.transaction,
            state: { status: "pending" },
            recovery: signed.recovery,
            createdAt: now,
            updatedAt: now,
          };

          await commit([transactionWrites.put(record)]);

          params.monitor.track(record);
          params.publishChanged({ type: "transactionsChanged", transactionIds: [record.transactionId] });
          return { transactionId: record.transactionId, signed };
        }),
      replacement,
    );

    const broadcast = await adapter.broadcast(signed);
    let transaction: Transaction;
    if (broadcast.status === "rejected") {
      transaction = await params.mutations.run(async (commit) => {
        const current = await readTransaction(params.readers.transactions, transactionId);
        if (current.state.status !== "pending") return current;

        const failed: TransactionRecord = {
          ...current,
          state: { status: "failed", failure: broadcast.failure },
          updatedAt: params.time.now(),
        };

        await commit([transactionWrites.put(failed)]);

        params.monitor.untrack(transactionId);
        params.publishChanged({ type: "transactionsChanged", transactionIds: [transactionId] });
        return failed;
      });
    } else {
      transaction = await readTransaction(params.readers.transactions, transactionId);
    }
    return adapter.createSubmission({ transaction, broadcast, transactionHash: signed.hash });
  },

  get: (transactionId) => params.readers.transactions.get(transactionId),
  list: (query) => params.readers.transactions.list(query),
});

const readTransaction = async (
  reader: Pick<TransactionsReader, "get">,
  transactionId: TransactionId,
): Promise<Transaction> => {
  const transaction = await reader.get(transactionId);
  if (!transaction) throw new TransactionNotFoundError(transactionId);
  return transaction;
};

const readReplaceableTransaction = async (
  reader: Pick<TransactionsReader, "get" | "listPending">,
  transactionId: TransactionId,
): Promise<Transaction> => {
  const target = await readTransaction(reader, transactionId);
  if (target.state.status !== "pending") {
    throw new TransactionReplacementUnavailableError({
      transactionId,
      status: target.state.status,
    });
  }

  const pendingTransactions = await reader.listPending();
  if (pendingTransactions.some((candidate) => candidate.replacesTransactionId === transactionId)) {
    throw new TransactionReplacementUnavailableError({
      transactionId,
      status: target.state.status,
      reason: "has_pending_replacement",
    });
  }

  return target;
};
