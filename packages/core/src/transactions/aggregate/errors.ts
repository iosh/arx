export class TransactionAggregateNotFoundError extends Error {
  readonly transactionId: string;

  constructor(transactionId: string) {
    super(`Transaction aggregate "${transactionId}" was not found.`);
    this.name = "TransactionAggregateNotFoundError";
    this.transactionId = transactionId;
  }
}

export class TransactionAggregateInvariantError extends Error {
  readonly transactionId: string;

  constructor(transactionId: string, message: string) {
    super(message);
    this.name = "TransactionAggregateInvariantError";
    this.transactionId = transactionId;
  }
}
