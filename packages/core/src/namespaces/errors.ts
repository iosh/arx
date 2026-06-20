import { ArxBaseError, type ErrorCause } from "../error.js";

export class NamespaceTransactionModuleMissingError extends ArxBaseError {
  static readonly code = "namespace.transaction_module_missing";

  constructor(params: ErrorCause & { namespace: string }) {
    super(`Runtime namespace "${params.namespace}" must provide runtime.createTransaction.`, {
      code: NamespaceTransactionModuleMissingError.code,
      details: { namespace: params.namespace },
      cause: params.cause,
    });
  }
}

export class NamespaceTransactionSignerMissingError extends ArxBaseError {
  static readonly code = "namespace.transaction_signer_missing";

  constructor(params: ErrorCause & { namespace: string }) {
    super(`Namespace transaction for namespace "${params.namespace}" requires a signer binding.`, {
      code: NamespaceTransactionSignerMissingError.code,
      details: { namespace: params.namespace },
      cause: params.cause,
    });
  }
}
