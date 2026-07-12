import { ArxBaseError } from "../../errors.js";
import type { JsonObject } from "../aggregate/index.js";

type TransactionAcceptanceCommitErrorInput = {
  transactionId: string;
  submissionId: string;
  broadcastIdentity: JsonObject;
  submitted: JsonObject;
  cause: unknown;
};

export class TransactionAcceptanceCommitError extends ArxBaseError {
  static readonly code = "transaction.submission.acceptance_commit_failed";

  readonly transactionId: string;
  readonly submissionId: string;
  readonly broadcastIdentity: JsonObject;
  readonly submitted: JsonObject;

  constructor(input: TransactionAcceptanceCommitErrorInput) {
    const details = {
      transactionId: input.transactionId,
      submissionId: input.submissionId,
      broadcastIdentity: structuredClone(input.broadcastIdentity),
      submitted: structuredClone(input.submitted),
    };

    super("Transaction was accepted by the network, but local acceptance commit failed.", {
      code: TransactionAcceptanceCommitError.code,
      details,
      cause: input.cause,
    });
    this.transactionId = details.transactionId;
    this.submissionId = details.submissionId;
    this.broadcastIdentity = details.broadcastIdentity;
    this.submitted = details.submitted;
  }
}

export class TransactionSubmissionTransactionNotFoundError extends ArxBaseError {
  static readonly code = "transaction.submission.transaction_not_found";

  readonly transactionId: string;

  constructor(transactionId: string) {
    super(`Transaction "${transactionId}" was not found.`, {
      code: TransactionSubmissionTransactionNotFoundError.code,
      details: { transactionId },
    });
    this.transactionId = transactionId;
  }
}

export class TransactionSubmissionNotSubmittableError extends ArxBaseError {
  static readonly code = "transaction.submission.not_submittable";

  readonly transactionId: string;
  readonly status: string;

  constructor(input: { transactionId: string; status: string }) {
    super(`Transaction "${input.transactionId}" is not submitting.`, {
      code: TransactionSubmissionNotSubmittableError.code,
      details: {
        transactionId: input.transactionId,
        status: input.status,
      },
    });
    this.transactionId = input.transactionId;
    this.status = input.status;
  }
}

export class TransactionSubmissionActiveSubmissionMissingError extends ArxBaseError {
  static readonly code = "transaction.submission.active_submission_missing";

  readonly transactionId: string;

  constructor(transactionId: string) {
    super(`Transaction "${transactionId}" is missing an active submission.`, {
      code: TransactionSubmissionActiveSubmissionMissingError.code,
      details: { transactionId },
    });
    this.transactionId = transactionId;
  }
}
