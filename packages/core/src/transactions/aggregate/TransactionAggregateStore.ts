import { TransactionAggregateNotFoundError } from "./errors.js";
import type { ListTransactionHistoryQuery, TransactionsStoragePort } from "./storagePort.js";
import { TransactionAggregateService } from "./TransactionAggregateService.js";
import type {
  ApproveTransactionInput,
  CreateTransactionInput,
  TerminalTransactionInput,
  TransactionAggregate,
  TransactionConflictKey,
  TransactionRecord,
} from "./types.js";

type TransactionAggregateStoreDeps = {
  storage: TransactionsStoragePort;
  now?: () => number;
  createId?: () => string;
};

const cloneAggregate = (aggregate: TransactionAggregate): TransactionAggregate => structuredClone(aggregate);

export class TransactionAggregateStore {
  #service: TransactionAggregateService;
  #storage: TransactionsStoragePort;

  constructor(deps: TransactionAggregateStoreDeps) {
    this.#storage = deps.storage;
    this.#service = new TransactionAggregateService({
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      ...(deps.createId !== undefined ? { createId: deps.createId } : {}),
    });
  }

  async loadTransactionAggregate(transactionId: string): Promise<TransactionAggregate | null> {
    const aggregate = await this.#storage.loadTransactionAggregate(transactionId);
    return aggregate ? cloneAggregate(aggregate) : null;
  }

  async createTransaction(input: CreateTransactionInput): Promise<TransactionAggregate> {
    const aggregate = this.#service.createTransaction(input);
    await this.#storage.insertTransactionAggregate(aggregate);
    return aggregate;
  }

  async approveTransaction(input: ApproveTransactionInput): Promise<TransactionAggregate> {
    return await this.#mutateExistingAggregate(input.transactionId, (aggregate) =>
      this.#service.approveTransaction(aggregate, input),
    );
  }

  async rejectTransaction(input: TerminalTransactionInput): Promise<TransactionAggregate> {
    return await this.#mutateExistingAggregate(input.transactionId, (aggregate) =>
      this.#service.rejectTransaction(aggregate, input),
    );
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

  async listTransactionHistory(query?: ListTransactionHistoryQuery): Promise<TransactionRecord[]> {
    const records = await this.#storage.listTransactionHistory(query);
    return structuredClone(records);
  }

  async findTransactionRecordsByConflictKey(key: TransactionConflictKey): Promise<TransactionRecord[]> {
    const records = await this.#storage.findTransactionRecordsByConflictKey(key);
    return structuredClone(records);
  }

  async #mutateExistingAggregate(
    transactionId: string,
    mutate: (aggregate: TransactionAggregate) => TransactionAggregate,
  ): Promise<TransactionAggregate> {
    const aggregate = await this.#storage.loadTransactionAggregate(transactionId);
    if (!aggregate) {
      throw new TransactionAggregateNotFoundError(transactionId);
    }

    const next = mutate(aggregate);
    await this.#storage.saveTransactionAggregate(next);
    return next;
  }
}
