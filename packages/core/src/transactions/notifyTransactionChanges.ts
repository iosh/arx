import type {
  ApproveTransactionInput,
  BeginSubmissionSigningInput,
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
import type { TransactionInvalidations } from "./TransactionInvalidations.js";

type TransactionLifecycleMutation =
  | "createTransaction"
  | "approveTransaction"
  | "rejectTransaction"
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

type TransactionHistoryInvalidatingStore = Omit<TransactionAggregateStore, TransactionLifecycleMutation> &
  Pick<TransactionAggregateStore, TransactionLifecycleMutation>;

const publishAggregateChange = (
  invalidations: Pick<TransactionInvalidations, "publishTransactionsChanged">,
  aggregate: TransactionAggregate,
): void => {
  invalidations.publishTransactionsChanged([aggregate.record.id]);
};

/** Publishes transaction invalidations after successful aggregate writes. */
export const notifyTransactionChanges = (
  store: TransactionAggregateStore,
  invalidations: Pick<TransactionInvalidations, "publishTransactionsChanged">,
): TransactionHistoryInvalidatingStore => ({
  loadTransactionAggregate: (transactionId) => store.loadTransactionAggregate(transactionId),
  listTransactionHistory: (query) => store.listTransactionHistory(query),
  findTransactionRecordsByConflictKey: (key) => store.findTransactionRecordsByConflictKey(key),
  listRecoverableTransactionAggregates: (query) => store.listRecoverableTransactionAggregates(query),
  listRestartActions: (query) => store.listRestartActions(query),

  async createTransaction(input) {
    const aggregate = await store.createTransaction(input);
    publishAggregateChange(invalidations, aggregate);
    return aggregate;
  },

  async approveTransaction(input: ApproveTransactionInput) {
    const aggregate = await store.approveTransaction(input);
    publishAggregateChange(invalidations, aggregate);
    return aggregate;
  },

  async rejectTransaction(input: TerminalTransactionInput) {
    const aggregate = await store.rejectTransaction(input);
    publishAggregateChange(invalidations, aggregate);
    return aggregate;
  },

  async cancelTransaction(input: TerminalTransactionInput) {
    const aggregate = await store.cancelTransaction(input);
    publishAggregateChange(invalidations, aggregate);
    return aggregate;
  },

  async expireTransaction(input: TerminalTransactionInput) {
    const aggregate = await store.expireTransaction(input);
    publishAggregateChange(invalidations, aggregate);
    return aggregate;
  },

  async failTransaction(input: FailTransactionInput) {
    const aggregate = await store.failTransaction(input);
    publishAggregateChange(invalidations, aggregate);
    return aggregate;
  },

  async beginSubmissionSigning(input: BeginSubmissionSigningInput) {
    const aggregate = await store.beginSubmissionSigning(input);
    publishAggregateChange(invalidations, aggregate);
    return aggregate;
  },

  async queueSubmissionBroadcast(input: QueueSubmissionBroadcastInput) {
    const aggregate = await store.queueSubmissionBroadcast(input);
    publishAggregateChange(invalidations, aggregate);
    return aggregate;
  },

  async recordBroadcastAcceptance(input: RecordBroadcastAcceptanceInput) {
    const aggregate = await store.recordBroadcastAcceptance(input);
    publishAggregateChange(invalidations, aggregate);
    return aggregate;
  },

  async failSubmission(input: TerminalSubmissionInput) {
    const aggregate = await store.failSubmission(input);
    publishAggregateChange(invalidations, aggregate);
    return aggregate;
  },

  async cancelSubmission(input: TerminalSubmissionInput) {
    const aggregate = await store.cancelSubmission(input);
    publishAggregateChange(invalidations, aggregate);
    return aggregate;
  },

  async expireSubmission(input: TerminalSubmissionInput) {
    const aggregate = await store.expireSubmission(input);
    publishAggregateChange(invalidations, aggregate);
    return aggregate;
  },

  async recordTransactionConfirmed(input: RecordTransactionReceiptInput) {
    const aggregate = await store.recordTransactionConfirmed(input);
    publishAggregateChange(invalidations, aggregate);
    return aggregate;
  },

  async recordTransactionFailedOnChain(input: RecordTransactionFailedOnChainInput) {
    const aggregate = await store.recordTransactionFailedOnChain(input);
    publishAggregateChange(invalidations, aggregate);
    return aggregate;
  },

  async recordTransactionReplaced(input: RecordTransactionReplacedInput) {
    const aggregate = await store.recordTransactionReplaced(input);
    publishAggregateChange(invalidations, aggregate);
    return aggregate;
  },

  async recordTransactionDropped(input: RecordTransactionDroppedInput) {
    const aggregate = await store.recordTransactionDropped(input);
    publishAggregateChange(invalidations, aggregate);
    return aggregate;
  },

  async recordTransactionExpired(input: RecordTransactionExpiredInput) {
    const aggregate = await store.recordTransactionExpired(input);
    publishAggregateChange(invalidations, aggregate);
    return aggregate;
  },
});
