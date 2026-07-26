import type { Accounts } from "../accounts/Accounts.js";
import { AccountNotFoundError } from "../accounts/errors.js";
import { NetworkNotFoundError } from "../networks/errors.js";
import type { NetworksReader } from "../networks/types.js";
import { persistenceChange } from "../persistence/change.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { CoreTime } from "../runtime/time.js";
import { TransactionNotFoundError, TransactionReplacementUnavailableError } from "./errors.js";
import { getTransactionsNamespaceAdapter, type TransactionsNamespaceAdapters } from "./namespaceAdapter.js";
import {
  type PendingTransactionRecord,
  type TransactionRecord,
  type TransactionsReader,
  transactionPersistenceType,
  transactionRecordToTransaction,
} from "./persistence.js";
import type { PreparedTransaction, PrepareTransactionInput } from "./preparedTransaction.js";
import type { TransactionMonitor } from "./TransactionMonitor.js";
import type {
  Transaction,
  TransactionBroadcastOutcome,
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
  monitor: Pick<TransactionMonitor, "track" | "stop">;
  publishChanged(change: TransactionsChanged): void;
}>;

export const createTransactions = (params: TransactionsOptions): Transactions => ({
  async prepare(input) {
    const adapter = getTransactionsNamespaceAdapter(params.adapters, input.namespace);
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

    const adapter = getTransactionsNamespaceAdapter(params.adapters, target.namespace);
    if (!params.accounts.getAccount(target.accountId)) throw new AccountNotFoundError(target.accountId);
    if (!params.networks.get(target.chainRef)) throw new NetworkNotFoundError(target.chainRef);

    const { canonicalAddress } = params.accounts.getAddress({
      chainRef: target.chainRef,
      accountId: target.accountId,
    });
    const prepared = await adapter.prepareReplacement({
      target,
      type: input.type,
      from: canonicalAddress,
    });

    return {
      ...prepared,
      initiator: { type: "wallet" },
      replacesTransactionId: target.transactionId,
    };
  },

  async submit(prepared) {
    const adapter = getTransactionsNamespaceAdapter(params.adapters, prepared.namespace);

    // Recheck before and after RPC-backed preparation because these prerequisites may change while it awaits.
    if (!params.accounts.getAccount(prepared.accountId)) throw new AccountNotFoundError(prepared.accountId);
    if (!params.networks.get(prepared.chainRef)) throw new NetworkNotFoundError(prepared.chainRef);
    if (prepared.replacesTransactionId !== undefined) {
      await readReplaceableTransaction(params.readers.transactions, prepared.replacesTransactionId);
    }

    const { pending, signed } = await adapter.withSigningInput(prepared, (signingInput) =>
      params.mutations.run(async (commit) => {
        if (!params.accounts.getAccount(prepared.accountId)) throw new AccountNotFoundError(prepared.accountId);
        if (!params.networks.get(prepared.chainRef)) throw new NetworkNotFoundError(prepared.chainRef);
        if (prepared.replacesTransactionId !== undefined) {
          await readReplaceableTransaction(params.readers.transactions, prepared.replacesTransactionId);
        }

        const signed = await adapter.sign(signingInput);
        const now = params.time.now();
        const record: PendingTransactionRecord = {
          transactionId: globalThis.crypto.randomUUID(),
          namespace: prepared.namespace,
          chainRef: prepared.chainRef,
          accountId: prepared.accountId,
          initiator: prepared.initiator,
          ...(prepared.replacesTransactionId === undefined
            ? {}
            : { replacesTransactionId: prepared.replacesTransactionId }),
          transaction: signed.transaction,
          state: { status: "pending" },
          recovery: signed.recovery,
          createdAt: now,
          updatedAt: now,
        };

        await commit([persistenceChange.put(transactionPersistenceType, record)]);

        params.publishChanged({ type: "transactionsChanged", transactionIds: [record.transactionId] });
        return { pending: record, signed };
      }),
    );

    let broadcast: TransactionBroadcastOutcome;
    try {
      broadcast = await adapter.broadcast(signed);
    } catch (error) {
      params.monitor.track(pending);
      throw error;
    }

    if (broadcast.status !== "rejected") {
      params.monitor.track(pending);
      return adapter.createSubmission({
        transaction: transactionRecordToTransaction(pending),
        broadcast,
      });
    }

    try {
      return await params.mutations.run(async (commit) => {
        const { recovery: _recovery, ...transaction } = pending;
        const failed: TransactionRecord = {
          ...transaction,
          state: { status: "failed", failure: broadcast.failure },
          updatedAt: params.time.now(),
        };

        await commit([persistenceChange.put(transactionPersistenceType, failed)]);

        params.monitor.stop(failed.transactionId);
        params.publishChanged({ type: "transactionsChanged", transactionIds: [failed.transactionId] });
        return adapter.createSubmission({
          transaction: transactionRecordToTransaction(failed),
          broadcast,
        });
      });
    } catch (error) {
      params.monitor.track(pending);
      throw error;
    }
  },

  get: (transactionId) => params.readers.transactions.get(transactionId),
  list: (query) => params.readers.transactions.list(query),
});

const readReplaceableTransaction = async (
  reader: Pick<TransactionsReader, "get" | "listPending">,
  transactionId: TransactionId,
): Promise<Transaction> => {
  const target = await reader.get(transactionId);
  if (!target) throw new TransactionNotFoundError(transactionId);
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
