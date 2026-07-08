import type {
  BeginSubmissionSigningInput,
  CreateApprovedTransactionInput,
  FailTransactionInput,
  QueueSubmissionBroadcastInput,
  RecordBroadcastAcceptanceInput,
  RecordTransactionDroppedInput,
  RecordTransactionExpiredInput,
  RecordTransactionFailedOnChainInput,
  RecordTransactionReceiptInput,
  RecordTransactionReplacedInput,
  TerminalSubmissionInput,
  TerminalTransactionInput,
  TransactionAggregate,
} from "./aggregate/index.js";
import type { TransactionAggregateStore } from "./aggregate/TransactionAggregateStore.js";
import type { TransactionChangePublisher } from "./TransactionChangePublisher.js";

type TransactionLifecycleMutation =
  | "createApprovedTransaction"
  | "cancelTransaction"
  | "expireTransaction"
  | "failTransaction"
  | "beginSubmissionSigning"
  | "queueSubmissionBroadcast"
  | "recordBroadcastAcceptance"
  | "failSubmission"
  | "cancelSubmission"
  | "expireSubmission"
  | "recordTransactionConfirmed"
  | "recordTransactionFailedOnChain"
  | "recordTransactionReplaced"
  | "recordTransactionDropped"
  | "recordTransactionExpired";

type TransactionChangePublishingStore = Omit<TransactionAggregateStore, TransactionLifecycleMutation> &
  Pick<TransactionAggregateStore, TransactionLifecycleMutation>;

const publishAggregateChange = (
  transactionChanges: Pick<TransactionChangePublisher, "publishTransactionsChanged">,
  aggregate: TransactionAggregate,
): Promise<void> => {
  return transactionChanges.publishTransactionsChanged([aggregate.record.id]);
};

export const notifyTransactionChanges = (
  store: TransactionAggregateStore,
  transactionChanges: Pick<TransactionChangePublisher, "publishTransactionsChanged">,
): TransactionChangePublishingStore => ({
  loadTransactionAggregate: (transactionId) => store.loadTransactionAggregate(transactionId),
  listTransactionHistory: (query) => store.listTransactionHistory(query),
  findTransactionRecordsByConflictKey: (key) => store.findTransactionRecordsByConflictKey(key),
  listRecoverableTransactionAggregates: (query) => store.listRecoverableTransactionAggregates(query),
  listRestartActions: (query) => store.listRestartActions(query),

  async createApprovedTransaction(input: CreateApprovedTransactionInput) {
    const aggregate = await store.createApprovedTransaction(input);
    await publishAggregateChange(transactionChanges, aggregate);
    return aggregate;
  },

  async cancelTransaction(input: TerminalTransactionInput) {
    const aggregate = await store.cancelTransaction(input);
    await publishAggregateChange(transactionChanges, aggregate);
    return aggregate;
  },

  async expireTransaction(input: TerminalTransactionInput) {
    const aggregate = await store.expireTransaction(input);
    await publishAggregateChange(transactionChanges, aggregate);
    return aggregate;
  },

  async failTransaction(input: FailTransactionInput) {
    const aggregate = await store.failTransaction(input);
    await publishAggregateChange(transactionChanges, aggregate);
    return aggregate;
  },

  async beginSubmissionSigning(input: BeginSubmissionSigningInput) {
    const aggregate = await store.beginSubmissionSigning(input);
    await publishAggregateChange(transactionChanges, aggregate);
    return aggregate;
  },

  async queueSubmissionBroadcast(input: QueueSubmissionBroadcastInput) {
    const aggregate = await store.queueSubmissionBroadcast(input);
    await publishAggregateChange(transactionChanges, aggregate);
    return aggregate;
  },

  async recordBroadcastAcceptance(input: RecordBroadcastAcceptanceInput) {
    const aggregate = await store.recordBroadcastAcceptance(input);
    await publishAggregateChange(transactionChanges, aggregate);
    return aggregate;
  },

  async failSubmission(input: TerminalSubmissionInput) {
    const aggregate = await store.failSubmission(input);
    await publishAggregateChange(transactionChanges, aggregate);
    return aggregate;
  },

  async cancelSubmission(input: TerminalSubmissionInput) {
    const aggregate = await store.cancelSubmission(input);
    await publishAggregateChange(transactionChanges, aggregate);
    return aggregate;
  },

  async expireSubmission(input: TerminalSubmissionInput) {
    const aggregate = await store.expireSubmission(input);
    await publishAggregateChange(transactionChanges, aggregate);
    return aggregate;
  },

  async recordTransactionConfirmed(input: RecordTransactionReceiptInput) {
    const aggregate = await store.recordTransactionConfirmed(input);
    await publishAggregateChange(transactionChanges, aggregate);
    return aggregate;
  },

  async recordTransactionFailedOnChain(input: RecordTransactionFailedOnChainInput) {
    const aggregate = await store.recordTransactionFailedOnChain(input);
    await publishAggregateChange(transactionChanges, aggregate);
    return aggregate;
  },

  async recordTransactionReplaced(input: RecordTransactionReplacedInput) {
    const aggregate = await store.recordTransactionReplaced(input);
    await publishAggregateChange(transactionChanges, aggregate);
    return aggregate;
  },

  async recordTransactionDropped(input: RecordTransactionDroppedInput) {
    const aggregate = await store.recordTransactionDropped(input);
    await publishAggregateChange(transactionChanges, aggregate);
    return aggregate;
  },

  async recordTransactionExpired(input: RecordTransactionExpiredInput) {
    const aggregate = await store.recordTransactionExpired(input);
    await publishAggregateChange(transactionChanges, aggregate);
    return aggregate;
  },
});
