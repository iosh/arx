import type { JsonValue } from "../aggregate/index.js";

type TransactionAcceptanceCommitErrorInput = {
  transactionId: string;
  submissionId: string;
  broadcastIdentity: JsonValue;
  submitted: JsonValue;
  cause: unknown;
};

export class TransactionAcceptanceCommitError extends Error {
  readonly transactionId: string;
  readonly submissionId: string;
  readonly broadcastIdentity: JsonValue;
  readonly submitted: JsonValue;

  constructor(input: TransactionAcceptanceCommitErrorInput) {
    super("Transaction was accepted by the network, but local acceptance commit failed.", {
      cause: input.cause,
    });
    this.name = "TransactionAcceptanceCommitError";
    this.transactionId = input.transactionId;
    this.submissionId = input.submissionId;
    this.broadcastIdentity = structuredClone(input.broadcastIdentity);
    this.submitted = structuredClone(input.submitted);
  }
}
