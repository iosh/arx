import { ArxBaseError, toJsonSafe } from "../errors.js";
import type { TransactionConflictKey, TransactionJsonObject, TransactionStatus } from "./persistence.js";

export class TransactionRecordNotFoundError extends ArxBaseError {
  static readonly code = "transaction.not_found";

  constructor(transactionId: string) {
    super("Transaction record was not found.", {
      code: TransactionRecordNotFoundError.code,
      details: { transactionId },
    });
  }
}

export class TransactionLifecycleTransitionError extends ArxBaseError {
  static readonly code = "transaction.lifecycle_transition_invalid";

  constructor(params: { transactionId: string; current: TransactionStatus; next: TransactionStatus }) {
    super("Transaction lifecycle transition is not allowed.", {
      code: TransactionLifecycleTransitionError.code,
      details: params,
    });
  }
}

export class TransactionConflictError extends ArxBaseError {
  static readonly code = "transaction.conflict";

  constructor(params: {
    transactionId: string;
    conflictKey: TransactionConflictKey;
    conflictingTransactionIds: readonly string[];
  }) {
    super("Transaction conflicts with an active transaction.", {
      code: TransactionConflictError.code,
      details: {
        transactionId: params.transactionId,
        conflictKey: params.conflictKey,
        conflictingTransactionIds: [...params.conflictingTransactionIds],
      },
    });
  }
}

export class TransactionReplacementTargetError extends ArxBaseError {
  static readonly code = "transaction.replacement_target_invalid";

  constructor(params: { submissionTransactionId?: string; targetTransactionId: string }) {
    super("Replacement target is not an active submitted transaction with the same conflict key.", {
      code: TransactionReplacementTargetError.code,
      details: {
        targetTransactionId: params.targetTransactionId,
        ...(params.submissionTransactionId ? { submissionTransactionId: params.submissionTransactionId } : {}),
      },
    });
  }
}

export class TransactionFinalizationRejectedError extends ArxBaseError {
  static readonly code = "transaction.finalization_rejected";

  constructor(params: { code: string; message: string; details?: TransactionJsonObject }) {
    const reasonDetails = params.details ? toJsonSafe(params.details) : undefined;
    super(params.message, {
      code: TransactionFinalizationRejectedError.code,
      details: {
        reasonCode: params.code,
        ...(reasonDetails ? { reasonDetails } : {}),
      },
    });
  }
}

export class TransactionNamespaceAdapterNotFoundError extends ArxBaseError {
  static readonly code = "transaction.namespace_adapter_not_found";

  constructor(namespace: string) {
    super("Transaction namespace adapter was not found.", {
      code: TransactionNamespaceAdapterNotFoundError.code,
      details: { namespace },
    });
  }
}
