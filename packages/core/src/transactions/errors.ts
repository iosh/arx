import { ArxBaseError } from "../errors.js";
import type { Namespace } from "../namespaces/types.js";
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
    reason?: "has_pending_replacement";
  }) {
    const message =
      input.reason === "has_pending_replacement"
        ? `Transaction "${input.transactionId}" already has a pending replacement.`
        : `Transaction "${input.transactionId}" cannot be replaced while it is ${input.status}.`;
    super(message, {
      code: TransactionReplacementUnavailableError.code,
      details: input,
    });
  }
}

export class TransactionNamespaceUnsupportedError extends ArxBaseError {
  static readonly code = "transaction.namespace_unsupported";

  constructor(namespace: Namespace) {
    super(`Transactions are not supported for namespace "${namespace}".`, {
      code: TransactionNamespaceUnsupportedError.code,
      details: { namespace },
    });
  }
}
