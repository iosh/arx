export class TransactionAggregateNotFoundError extends Error {
  readonly transactionId: string;

  constructor(transactionId: string) {
    super(`Transaction aggregate "${transactionId}" was not found.`);
    this.name = "TransactionAggregateNotFoundError";
    this.transactionId = transactionId;
  }
}

export class TransactionAggregateConflictError extends Error {
  readonly transactionId: string;

  constructor(transactionId: string) {
    super(`Transaction aggregate "${transactionId}" already exists.`);
    this.name = "TransactionAggregateConflictError";
    this.transactionId = transactionId;
  }
}

export class TransactionSubmissionArtifactConflictError extends Error {
  readonly artifactId: string;

  constructor(artifactId: string) {
    super(`Transaction submission artifact "${artifactId}" already exists.`);
    this.name = "TransactionSubmissionArtifactConflictError";
    this.artifactId = artifactId;
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
