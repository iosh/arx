import type { Accounts } from "../accounts/Accounts.js";
import { AccountNotFoundError } from "../accounts/errors.js";
import { NetworkNotFoundError } from "../networks/errors.js";
import type { NetworksReader } from "../networks/types.js";
import { persistenceChange } from "../persistence/change.js";
import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { CoreMutationQueue } from "../persistence/mutationQueue.js";
import type { CoreTime } from "../runtime/time.js";
import { getTransactionsNamespaceAdapter, type TransactionsNamespaceAdapters } from "./namespaceAdapter.js";
import {
  type PendingTransactionRecord,
  type TransactionRecord,
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
  TransactionSubmission,
} from "./types.js";

export type TransactionsChanged = Readonly<{
  type: "transactionsChanged";
  transactionIds: readonly TransactionId[];
}>;

export type Transactions = Readonly<{
  prepare(input: PrepareTransactionInput): Promise<PreparedTransaction>;
  submit(prepared: PreparedTransaction): Promise<TransactionSubmission>;
  get(transactionId: TransactionId): Promise<Transaction | null>;
  list(query: TransactionQuery): Promise<TransactionPage>;
}>;

type TransactionsOptions = Readonly<{
  readers: Pick<CorePersistenceReaders, "transactions">;
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

  async submit(prepared) {
    const adapter = getTransactionsNamespaceAdapter(params.adapters, prepared.namespace);
    if (!params.accounts.getAccount(prepared.accountId)) throw new AccountNotFoundError(prepared.accountId);
    if (!params.networks.get(prepared.chainRef)) throw new NetworkNotFoundError(prepared.chainRef);

    const signingInput = await adapter.createSigningInput(prepared);

    const { pending, signed, startMonitoring } = await params.mutations.run(async (commit) => {
      if (!params.accounts.getAccount(prepared.accountId)) throw new AccountNotFoundError(prepared.accountId);
      if (!params.networks.get(prepared.chainRef)) throw new NetworkNotFoundError(prepared.chainRef);

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

      const startMonitoring = params.monitor.track(record);
      params.publishChanged({ type: "transactionsChanged", transactionIds: [record.transactionId] });
      return { pending: record, signed, startMonitoring };
    });

    let broadcast: TransactionBroadcastOutcome;
    try {
      broadcast = await adapter.broadcast(signed);
    } catch (error) {
      startMonitoring();
      throw error;
    }

    if (broadcast.status !== "rejected") {
      startMonitoring();
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
      params.monitor.stop(pending.transactionId);
      throw error;
    }
  },

  get: (transactionId) => params.readers.transactions.get(transactionId),
  list: (query) => params.readers.transactions.list(query),
});
