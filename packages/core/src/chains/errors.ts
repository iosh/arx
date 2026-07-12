import { ArxBaseError } from "../errors.js";

export type ChainInvalidRefRule =
  | "type"
  | "namespace:reference"
  | "single_colon"
  | "namespace"
  | "reference"
  | "pattern";

export class ChainInvalidRefError extends ArxBaseError {
  static readonly code = "chain.invalid_ref";

  constructor(rule: ChainInvalidRefRule) {
    super("Invalid CAIP-2 chainRef.", {
      code: ChainInvalidRefError.code,
      details: { rule },
    });
  }
}

export class ChainNotFoundError extends ArxBaseError {
  static readonly code = "chain.not_found";

  constructor() {
    super("Requested chain is not registered with ARX.", {
      code: ChainNotFoundError.code,
    });
  }
}

export class ChainNotAvailableError extends ArxBaseError {
  static readonly code = "chain.not_available";

  constructor(message = "Requested chain is not available.") {
    super(message, {
      code: ChainNotAvailableError.code,
    });
  }
}

export type ChainRpcAccessConfigInput = {
  chainRef: string;
  reason: "duplicate" | "empty_endpoints" | "missing_endpoints";
};

export class ChainRpcAccessConfigError extends ArxBaseError {
  static readonly code = "chain.rpc_access_config_invalid";

  constructor(params: ChainRpcAccessConfigInput) {
    const messageByReason = {
      duplicate: "Duplicate chain RPC access configuration.",
      empty_endpoints: "Chain RPC access requires at least one endpoint.",
      missing_endpoints: "Chain RPC access requires configured endpoints.",
    } satisfies Record<ChainRpcAccessConfigInput["reason"], string>;
    super(messageByReason[params.reason], {
      code: ChainRpcAccessConfigError.code,
      details: { chainRef: params.chainRef, reason: params.reason },
    });
  }
}

export class ChainNotSupportedError extends ArxBaseError {
  static readonly code = "chain.not_supported";

  constructor(message = "Requested chain is not supported.") {
    super(message, {
      code: ChainNotSupportedError.code,
    });
  }
}

export class ChainNotCompatibleError extends ArxBaseError {
  static readonly code = "chain.not_compatible";

  constructor(message = "Requested chain is not compatible with this operation.") {
    super(message, {
      code: ChainNotCompatibleError.code,
    });
  }
}

export class ChainNamespaceMismatchError extends ArxBaseError {
  static readonly code = "chain.namespace_mismatch";

  constructor(params: { chainRef: string; expected: string; actual: string }) {
    super(`Chain ${params.chainRef} does not belong to namespace "${params.expected}".`, {
      code: ChainNamespaceMismatchError.code,
      details: {
        chainRef: params.chainRef,
        expectedNamespace: params.expected,
        actualNamespace: params.actual,
      },
    });
  }
}

export class ChainAddressNamespaceNotSupportedError extends ArxBaseError {
  static readonly code = "chain.address_namespace_not_supported";

  constructor(params: { chainRef: string; namespace: string }) {
    super(`No chain address handling is available for "${params.chainRef}".`, {
      code: ChainAddressNamespaceNotSupportedError.code,
      details: { chainRef: params.chainRef, namespace: params.namespace },
    });
  }
}

export class ChainInvalidAddressError extends ArxBaseError {
  static readonly code = "chain.address.invalid";

  constructor(params: { namespace: string; field: "input" | "canonical" }) {
    super(`Invalid ${params.namespace} address.`, {
      code: params.namespace === "eip155" ? "eip155.address.invalid" : ChainInvalidAddressError.code,
      details: { namespace: params.namespace, field: params.field },
    });
  }
}

export class ChainDefinitionConflictError extends ArxBaseError {
  static readonly code = "chain.definition_conflict";

  constructor(chainRef: string) {
    super("Requested chain conflicts with a builtin chain definition.", {
      code: ChainDefinitionConflictError.code,
      details: { chainRef },
    });
  }
}

export class CustomChainNotFoundError extends ArxBaseError {
  static readonly code = "chain.custom_not_found";

  constructor(chainRef: string) {
    super("Requested custom chain does not exist.", {
      code: CustomChainNotFoundError.code,
      details: { chainRef },
    });
  }
}

export type CustomChainRemovalRejectedReason = "wallet_selected" | "active_transaction";

export class CustomChainRemovalRejectedError extends ArxBaseError {
  static readonly code = "chain.custom_removal_rejected";

  constructor(chainRef: string, reason: CustomChainRemovalRejectedReason) {
    super("Custom chain cannot be removed while it is in active use.", {
      code: CustomChainRemovalRejectedError.code,
      details: { chainRef, reason },
    });
  }
}

export class WalletChainSelectionUnavailableError extends ArxBaseError {
  static readonly code = "chain.wallet_selection_unavailable";

  constructor(namespace: string) {
    super("No wallet chain is selected for the requested namespace.", {
      code: WalletChainSelectionUnavailableError.code,
      details: { namespace },
    });
  }
}

export class DuplicateBuiltinChainDefinitionError extends ArxBaseError {
  static readonly code = "chain.definition.duplicate_builtin";

  constructor(chainRef: string) {
    super("Duplicate builtin chain definition.", {
      code: DuplicateBuiltinChainDefinitionError.code,
      details: { chainRef },
    });
  }
}

export class ChainDefinitionRpcUrlsRequiredError extends ArxBaseError {
  static readonly code = "chain.definition.rpc_urls_required";

  constructor(chainRef: string) {
    super("At least one valid RPC URL is required.", {
      code: ChainDefinitionRpcUrlsRequiredError.code,
      details: { chainRef },
    });
  }
}

export class ChainBootstrapInvariantError extends ArxBaseError {
  static readonly code = "chain.bootstrap_invariant";

  constructor() {
    super("Chain bootstrap expected at least one available chain.", {
      code: ChainBootstrapInvariantError.code,
    });
  }
}

export class ChainAdmissionConfigError extends ArxBaseError {
  static readonly code = "chain.admission_config_invalid";

  constructor(reason: "missing_admitted_chain") {
    super("Chain admission configuration is invalid.", {
      code: ChainAdmissionConfigError.code,
      details: { reason },
    });
  }
}

export class ChainBootstrapHydrationError extends ArxBaseError {
  static readonly code = "chain.bootstrap_hydration_failed";

  constructor(
    resource: "walletChainSelection" | "chainRpcDefaultEndpoints" | "chainRpcEndpointOverrides",
    cause: unknown,
  ) {
    super("Failed to hydrate chain bootstrap state.", {
      code: ChainBootstrapHydrationError.code,
      details: { resource },
      cause,
    });
  }
}
