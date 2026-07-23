import { ArxBaseError } from "../errors.js";
import type { Namespace } from "../namespaces/types.js";

export class TransactionNamespaceUnsupportedError extends ArxBaseError {
  static readonly code = "transaction.namespace_unsupported";

  constructor(namespace: Namespace) {
    super(`Transactions are not supported for namespace "${namespace}".`, {
      code: TransactionNamespaceUnsupportedError.code,
      details: { namespace },
    });
  }
}
