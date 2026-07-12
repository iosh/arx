import { ArxBaseError } from "../errors.js";
import type { TransactionStatus } from "./aggregate/index.js";

export class TransactionReplacementUnavailableError extends ArxBaseError {
  static readonly code = "transaction.replacement.unavailable";

  readonly transactionId: string;
  readonly status: TransactionStatus;

  constructor(params: { transactionId: string; status: TransactionStatus }) {
    super("Transaction cannot be replaced in its current state.", {
      code: TransactionReplacementUnavailableError.code,
      details: {
        transactionId: params.transactionId,
        status: params.status,
      },
    });
    this.transactionId = params.transactionId;
    this.status = params.status;
  }
}
