import { ArxBaseError, type ErrorCause } from "../error.js";

export type ChainInvalidRefRule =
  | "type"
  | "namespace:reference"
  | "single_colon"
  | "namespace"
  | "reference"
  | "pattern";

export type ChainInvalidRefInput = ErrorCause & {
  rule: ChainInvalidRefRule;
};

export class ChainInvalidRefError extends ArxBaseError {
  static readonly code = "chain.invalid_ref";

  constructor(input: ChainInvalidRefInput) {
    super("Invalid CAIP-2 chainRef.", {
      code: ChainInvalidRefError.code,
      details: { rule: input.rule },
      cause: input.cause,
    });
  }
}

export class ChainNotFoundError extends ArxBaseError {
  static readonly code = "chain.not_found";

  constructor(input: ErrorCause = {}) {
    super("Requested chain is not registered with ARX.", {
      code: ChainNotFoundError.code,
      cause: input.cause,
    });
  }
}

export type ChainAvailabilityInput = ErrorCause & {
  message?: string;
};

export class ChainNotAvailableError extends ArxBaseError {
  static readonly code = "chain.not_available";

  constructor(params: ChainAvailabilityInput = {}) {
    super(params.message ?? "Requested chain is not available in network runtime.", {
      code: ChainNotAvailableError.code,
      cause: params.cause,
    });
  }
}

export type ChainRpcAccessConfigInput = ErrorCause & {
  chainRef: string;
  reason: "duplicate" | "empty_endpoints";
};

export class ChainRpcAccessConfigError extends ArxBaseError {
  static readonly code = "chain.rpc_access_config_invalid";

  constructor(params: ChainRpcAccessConfigInput) {
    const message =
      params.reason === "duplicate"
        ? "Duplicate chain RPC access configuration."
        : "Chain RPC access requires at least one endpoint.";
    super(message, {
      code: ChainRpcAccessConfigError.code,
      details: { chainRef: params.chainRef, reason: params.reason },
      cause: params.cause,
    });
  }
}

export class ChainNotSupportedError extends ArxBaseError {
  static readonly code = "chain.not_supported";

  constructor(params: ChainAvailabilityInput = {}) {
    super(params.message ?? "Requested chain is not supported.", {
      code: ChainNotSupportedError.code,
      cause: params.cause,
    });
  }
}

export class ChainNotCompatibleError extends ArxBaseError {
  static readonly code = "chain.not_compatible";

  constructor(params: ChainAvailabilityInput = {}) {
    super(params.message ?? "Requested chain is not compatible with this operation.", {
      code: ChainNotCompatibleError.code,
      cause: params.cause,
    });
  }
}

export class ChainNamespaceMismatchError extends ArxBaseError {
  static readonly code = "chain.namespace_mismatch";

  constructor(params: ErrorCause & { chainRef: string; expected: string; actual: string }) {
    super(`Chain ${params.chainRef} does not belong to namespace "${params.expected}".`, {
      code: ChainNamespaceMismatchError.code,
      details: {
        chainRef: params.chainRef,
        expectedNamespace: params.expected,
        actualNamespace: params.actual,
      },
      cause: params.cause,
    });
  }
}

export class ChainAddressNamespaceNotSupportedError extends ArxBaseError {
  static readonly code = "chain.address_namespace_not_supported";

  constructor(params: ErrorCause & { chainRef: string; namespace: string }) {
    super(`No chain address handling is available for "${params.chainRef}".`, {
      code: ChainAddressNamespaceNotSupportedError.code,
      details: { chainRef: params.chainRef, namespace: params.namespace },
      cause: params.cause,
    });
  }
}

export class ChainInvalidAddressError extends ArxBaseError {
  static readonly code = "chain.address.invalid";

  constructor(params: ErrorCause & { namespace: string; field: "input" | "canonical" }) {
    super(`Invalid ${params.namespace} address.`, {
      code: params.namespace === "eip155" ? "eip155.address.invalid" : ChainInvalidAddressError.code,
      details: { namespace: params.namespace, field: params.field },
      cause: params.cause,
    });
  }
}

export class ChainDefinitionConflictError extends ArxBaseError {
  static readonly code = "chain.definition_conflict";

  constructor(params: ErrorCause & { chainRef: string }) {
    super("Requested chain conflicts with a builtin chain definition.", {
      code: ChainDefinitionConflictError.code,
      details: { chainRef: params.chainRef },
      cause: params.cause,
    });
  }
}
