import { ArxBaseError, type ErrorCause } from "../error.js";

export class WalletNamespaceManifestNotFoundError extends ArxBaseError {
  static readonly code = "wallet.namespace_manifest_not_found";

  constructor(params: ErrorCause & { namespace: string }) {
    super(`Namespace manifest "${params.namespace}" is not installed.`, {
      code: WalletNamespaceManifestNotFoundError.code,
      details: { namespace: params.namespace },
      cause: params.cause,
    });
  }
}

export class DuplicateWalletNamespaceManifestError extends ArxBaseError {
  static readonly code = "wallet.duplicate_namespace_manifest";

  constructor(params: ErrorCause & { namespace: string }) {
    super(`Duplicate wallet namespace manifest "${params.namespace}".`, {
      code: DuplicateWalletNamespaceManifestError.code,
      details: { namespace: params.namespace },
      cause: params.cause,
    });
  }
}
