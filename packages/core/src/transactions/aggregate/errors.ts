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

export class TransactionConflictKeyCollisionError extends Error {
  readonly transactionId: string;
  readonly conflictKey: { kind: string; value: string };
  readonly conflictingTransactionIds: readonly string[];

  constructor(params: {
    transactionId: string;
    conflictKey: { kind: string; value: string };
    conflictingTransactionIds: readonly string[];
  }) {
    super(
      `Transaction "${params.transactionId}" conflicts with active transactions on conflict key "${params.conflictKey.kind}:${params.conflictKey.value}".`,
    );
    this.name = "TransactionConflictKeyCollisionError";
    this.transactionId = params.transactionId;
    this.conflictKey = params.conflictKey;
    this.conflictingTransactionIds = params.conflictingTransactionIds;
  }
}
