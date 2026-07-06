import { ArxBaseError, type JsonValue } from "../../error.js";

export class SubmittedTransactionTrackingInvariantError extends ArxBaseError {
  static readonly code = "transaction.tracking.invariant";

  readonly transactionId: string;

  constructor(transactionId: string, message: string) {
    super(message, {
      code: SubmittedTransactionTrackingInvariantError.code,
      details: { transactionId },
    });
    this.transactionId = transactionId;
  }
}

export class SubmittedTransactionTrackingCadenceError extends ArxBaseError {
  static readonly code = "transaction.tracking.cadence";

  readonly namespace: string;
  readonly operation: string;
  readonly delay: JsonValue | undefined;

  constructor(input: { namespace: string; operation: string; delay?: JsonValue | undefined }) {
    super(`Namespace transaction "${input.namespace}" returned an invalid ${input.operation} delay.`, {
      code: SubmittedTransactionTrackingCadenceError.code,
      details: {
        namespace: input.namespace,
        operation: input.operation,
        ...(input.delay !== undefined ? { delay: input.delay } : {}),
      },
    });
    this.namespace = input.namespace;
    this.operation = input.operation;
    this.delay = input.delay;
  }
}
