import { ArxBaseError } from "../../error.js";

export class NamespaceTransactionAlreadyRegisteredError extends ArxBaseError {
  static readonly code = "transaction.namespace.already_registered";

  constructor(namespace: string) {
    super(`Duplicate namespace transaction "${namespace}".`, {
      code: NamespaceTransactionAlreadyRegisteredError.code,
      details: { namespace },
    });
  }
}

export class NamespaceTransactionNotFoundError extends ArxBaseError {
  static readonly code = "transaction.namespace.not_found";

  constructor(namespace: string) {
    super(`Missing namespace transaction "${namespace}".`, {
      code: NamespaceTransactionNotFoundError.code,
      details: { namespace },
    });
  }
}
