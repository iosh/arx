export class TransactionApprovalSessionNotFoundError extends Error {
  readonly approvalId: string;

  constructor(approvalId: string) {
    super(`Transaction approval session "${approvalId}" was not found.`);
    this.name = "TransactionApprovalSessionNotFoundError";
    this.approvalId = approvalId;
  }
}

export class TransactionApprovalSessionConflictError extends Error {
  readonly approvalId: string;

  constructor(approvalId: string, message: string) {
    super(message);
    this.name = "TransactionApprovalSessionConflictError";
    this.approvalId = approvalId;
  }
}

export class TransactionApprovalSessionInvariantError extends Error {
  readonly approvalId: string;

  constructor(approvalId: string, message: string) {
    super(message);
    this.name = "TransactionApprovalSessionInvariantError";
    this.approvalId = approvalId;
  }
}
