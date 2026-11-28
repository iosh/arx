import { ArxBaseError } from "../errors.js";
import type { TransactionId, TransactionStatus } from "./types.js";

export class TransactionNotFoundError extends ArxBaseError {
  static readonly code = "transaction.not_found";

  constructor(transactionId: TransactionId) {
    super(`Transaction "${transactionId}" was not found.`, {
      code: TransactionNotFoundError.code,
      details: { transactionId },
    });
  }
}

export class TransactionReplacementUnavailableError extends ArxBaseError {
  static readonly code = "transaction.replacement_unavailable";

  constructor(input: {
    transactionId: TransactionId;
    status: TransactionStatus;
    reason?: "has_pending_replacement" | "nonce_consumed";
  }) {
    let message = `Transaction "${input.transactionId}" cannot be replaced while it is ${input.status}.`;
    if (input.reason === "has_pending_replacement") {
      message = `Transaction "${input.transactionId}" already has a pending replacement.`;
    } else if (input.reason === "nonce_consumed") {
      message = `The nonce for transaction "${input.transactionId}" has already been used on chain.`;
    }
    super(message, {
      code: TransactionReplacementUnavailableError.code,
      details: input,
    });
  }
}
