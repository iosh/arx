import { ArxBaseError } from "../errors.js";

export class WalletNamespaceManifestRequiredError extends ArxBaseError {
  static readonly code = "wallet.namespace_manifest_required";

  constructor() {
    super("At least one namespace manifest is required.", {
      code: WalletNamespaceManifestRequiredError.code,
    });
  }
}

export class WalletNamespaceManifestNotFoundError extends ArxBaseError {
  static readonly code = "wallet.namespace_manifest_not_found";

  constructor(namespace: string) {
    super(`Namespace manifest "${namespace}" is not installed.`, {
      code: WalletNamespaceManifestNotFoundError.code,
      details: { namespace },
    });
  }
}

export class DuplicateWalletNamespaceManifestError extends ArxBaseError {
  static readonly code = "wallet.duplicate_namespace_manifest";

  constructor(namespace: string) {
    super(`Duplicate wallet namespace manifest "${namespace}".`, {
      code: DuplicateWalletNamespaceManifestError.code,
      details: { namespace },
    });
  }
}
