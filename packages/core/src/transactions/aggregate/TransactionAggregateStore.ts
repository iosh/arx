import { TransactionAggregateNotFoundError } from "./errors.js";
import type {
  ListRecoverableTransactionAggregatesQuery,
  ListTransactionHistoryQuery,
  TransactionsStoragePort,
} from "./storagePort.js";
import { TransactionAggregateService } from "./TransactionAggregateService.js";
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
  TransactionAggregateServiceOptions,
  TransactionConflictKey,
  TransactionRecord,
  TransactionRestartAction,
} from "./types.js";

type TransactionAggregateStoreDeps = {
  transactionsPort: TransactionsStoragePort;
  now?: () => number;
  createId?: () => string;
};

const cloneAggregate = (aggregate: TransactionAggregate): TransactionAggregate => structuredClone(aggregate);

export class TransactionAggregateStore {
  #service: TransactionAggregateService;
  #transactionsPort: TransactionsStoragePort;

  constructor(deps: TransactionAggregateStoreDeps) {
    this.#transactionsPort = deps.transactionsPort;
    const serviceOptions: TransactionAggregateServiceOptions = {};
    if (deps.now !== undefined) {
      serviceOptions.now = deps.now;
    }
    if (deps.createId !== undefined) {
      serviceOptions.createId = deps.createId;
    }
    this.#service = new TransactionAggregateService(serviceOptions);
  }

  async loadTransactionAggregate(transactionId: string): Promise<TransactionAggregate | null> {
    const aggregate = await this.#transactionsPort.loadTransactionAggregate(transactionId);
    return aggregate ? cloneAggregate(aggregate) : null;
  }

  async createApprovedTransaction(input: CreateApprovedTransactionInput): Promise<TransactionAggregate> {
    const aggregate = this.#service.createApprovedTransaction(input);
    await this.#transactionsPort.insertApprovedTransactionAggregate({ aggregate });
    return aggregate;
  }

  async cancelTransaction(input: TerminalTransactionInput): Promise<TransactionAggregate> {
    return await this.#mutateExistingAggregate(input.transactionId, (aggregate) =>
      this.#service.cancelTransaction(aggregate, input),
    );
  }

  async expireTransaction(input: TerminalTransactionInput): Promise<TransactionAggregate> {
    return await this.#mutateExistingAggregate(input.transactionId, (aggregate) =>
      this.#service.expireTransaction(aggregate, input),
    );
  }

  async failTransaction(input: FailTransactionInput): Promise<TransactionAggregate> {
    return await this.#mutateExistingAggregate(input.transactionId, (aggregate) =>
      this.#service.failTransaction(aggregate, input),
    );
  }

  async beginSubmissionSigning(input: BeginSubmissionSigningInput): Promise<TransactionAggregate> {
    return await this.#mutateExistingAggregate(input.transactionId, (aggregate) =>
      this.#service.beginSubmissionSigning(aggregate, input),
    );
  }

  async queueSubmissionBroadcast(input: QueueSubmissionBroadcastInput): Promise<TransactionAggregate> {
    return await this.#mutateExistingAggregate(input.transactionId, (aggregate) =>
      this.#service.queueSubmissionBroadcast(aggregate, input),
    );
  }

  async recordBroadcastAcceptance(input: RecordBroadcastAcceptanceInput): Promise<TransactionAggregate> {
    return await this.#mutateExistingAggregate(input.transactionId, (aggregate) =>
      this.#service.recordBroadcastAcceptance(aggregate, input),
    );
  }

  async failSubmission(input: TerminalSubmissionInput): Promise<TransactionAggregate> {
    return await this.#mutateExistingAggregate(input.transactionId, (aggregate) =>
      this.#service.failSubmission(aggregate, input),
    );
  }

  async cancelSubmission(input: TerminalSubmissionInput): Promise<TransactionAggregate> {
    return await this.#mutateExistingAggregate(input.transactionId, (aggregate) =>
      this.#service.cancelSubmission(aggregate, input),
    );
  }

  async expireSubmission(input: TerminalSubmissionInput): Promise<TransactionAggregate> {
    return await this.#mutateExistingAggregate(input.transactionId, (aggregate) =>
      this.#service.expireSubmission(aggregate, input),
    );
  }

  async recordTransactionConfirmed(input: RecordTransactionReceiptInput): Promise<TransactionAggregate> {
    return await this.#mutateExistingAggregate(input.transactionId, (aggregate) =>
      this.#service.recordTransactionConfirmed(aggregate, input),
    );
  }

  async recordTransactionFailedOnChain(input: RecordTransactionFailedOnChainInput): Promise<TransactionAggregate> {
    return await this.#mutateExistingAggregate(input.transactionId, (aggregate) =>
      this.#service.recordTransactionFailedOnChain(aggregate, input),
    );
  }

  async recordTransactionReplaced(input: RecordTransactionReplacedInput): Promise<TransactionAggregate> {
    return await this.#mutateExistingAggregate(input.transactionId, (aggregate) =>
      this.#service.recordTransactionReplaced(aggregate, input),
    );
  }

  async recordTransactionDropped(input: RecordTransactionDroppedInput): Promise<TransactionAggregate> {
    return await this.#mutateExistingAggregate(input.transactionId, (aggregate) =>
      this.#service.recordTransactionDropped(aggregate, input),
    );
  }

  async recordTransactionExpired(input: RecordTransactionExpiredInput): Promise<TransactionAggregate> {
    return await this.#mutateExistingAggregate(input.transactionId, (aggregate) =>
      this.#service.recordTransactionExpired(aggregate, input),
    );
  }

  async listTransactionHistory(query?: ListTransactionHistoryQuery): Promise<TransactionRecord[]> {
    const records = await this.#transactionsPort.listTransactionHistory(query);
    return structuredClone(records);
  }

  async findTransactionRecordsByConflictKey(key: TransactionConflictKey): Promise<TransactionRecord[]> {
    const records = await this.#transactionsPort.findTransactionRecordsByConflictKey(key);
    return structuredClone(records);
  }

  async listRecoverableTransactionAggregates(
    query?: ListRecoverableTransactionAggregatesQuery,
  ): Promise<TransactionAggregate[]> {
    const aggregates = await this.#transactionsPort.listRecoverableTransactionAggregates(query);
    return structuredClone(aggregates);
  }

  async listRestartActions(query?: ListRecoverableTransactionAggregatesQuery): Promise<TransactionRestartAction[]> {
    const aggregates = await this.#transactionsPort.listRecoverableTransactionAggregates(query);
    return aggregates.flatMap((aggregate) => this.#service.listRestartActions(aggregate));
  }

  async #mutateExistingAggregate(
    transactionId: string,
    mutate: (aggregate: TransactionAggregate) => TransactionAggregate,
  ): Promise<TransactionAggregate> {
    const aggregate = await this.#transactionsPort.loadTransactionAggregate(transactionId);
    if (!aggregate) {
      throw new TransactionAggregateNotFoundError(transactionId);
    }

    const next = mutate(aggregate);
    await this.#transactionsPort.saveTransactionAggregate(next);
    return next;
  }
}
