import { ArxBaseError } from "../../errors.js";

export class TransactionAggregateNotFoundError extends ArxBaseError {
  static readonly code = "transaction.aggregate.not_found";

  readonly transactionId: string;

  constructor(transactionId: string) {
    super(`Transaction aggregate "${transactionId}" was not found.`, {
      code: TransactionAggregateNotFoundError.code,
      details: { transactionId },
    });
    this.transactionId = transactionId;
  }
}

export class TransactionAggregateAlreadyExistsError extends ArxBaseError {
  static readonly code = "transaction.aggregate.already_exists";

  readonly transactionId: string;

  constructor(transactionId: string) {
    super(`Transaction aggregate "${transactionId}" already exists.`, {
      code: TransactionAggregateAlreadyExistsError.code,
      details: { transactionId },
    });
    this.transactionId = transactionId;
  }
}

export class TransactionAggregateInvariantError extends ArxBaseError {
  static readonly code = "transaction.aggregate.invariant";

  readonly transactionId: string;

  constructor(transactionId: string, message: string) {
    super(message, {
      code: TransactionAggregateInvariantError.code,
      details: { transactionId },
    });
    this.transactionId = transactionId;
  }
}

export class TransactionConflictKeyCollisionError extends ArxBaseError {
  static readonly code = "transaction.aggregate.conflict_key_collision";

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
      {
        code: TransactionConflictKeyCollisionError.code,
        details: {
          transactionId: params.transactionId,
          conflictKey: params.conflictKey,
          conflictingTransactionIds: [...params.conflictingTransactionIds],
        },
      },
    );
    this.transactionId = params.transactionId;
    this.conflictKey = params.conflictKey;
    this.conflictingTransactionIds = params.conflictingTransactionIds;
  }
}
