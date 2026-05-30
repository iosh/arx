export class TransactionApprovalSessionNotFoundError extends Error {
  readonly transactionId: string;

  constructor(transactionId: string) {
    super(`Transaction approval session "${transactionId}" was not found.`);
    this.name = "TransactionApprovalSessionNotFoundError";
    this.transactionId = transactionId;
  }
}

export class TransactionApprovalSessionConflictError extends Error {
  readonly transactionId: string;

  constructor(transactionId: string, message: string) {
    super(message);
    this.name = "TransactionApprovalSessionConflictError";
    this.transactionId = transactionId;
  }
}

export class TransactionApprovalSessionInvariantError extends Error {
  readonly transactionId: string;

  constructor(transactionId: string, message: string) {
    super(message);
    this.name = "TransactionApprovalSessionInvariantError";
    this.transactionId = transactionId;
  }
}
