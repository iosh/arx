import { ArxBaseError } from "../errors.js";
import type { Namespace } from "../namespaces/types.js";
import type { ChainRef } from "./chainRef.js";

export type InvalidChainRefRule = "type" | "namespace:reference" | "single_colon" | "namespace" | "reference";

export class InvalidChainRefError extends ArxBaseError {
  static readonly code = "network.invalid_chain_ref";

  constructor(rule: InvalidChainRefRule) {
    super("Invalid CAIP-2 chain reference.", {
      code: InvalidChainRefError.code,
      details: { rule },
    });
  }
}

export class ChainNamespaceMismatchError extends ArxBaseError {
  static readonly code = "network.chain_namespace_mismatch";

  constructor(input: { chainRef: ChainRef; expectedNamespace: Namespace; actualNamespace: Namespace }) {
    super(`Chain "${input.chainRef}" does not belong to namespace "${input.expectedNamespace}".`, {
      code: ChainNamespaceMismatchError.code,
      details: input,
    });
  }
}

export class NetworkNotFoundError extends ArxBaseError {
  static readonly code = "network.not_found";

  constructor(chainRef: ChainRef) {
    super(`Network "${chainRef}" was not found.`, {
      code: NetworkNotFoundError.code,
      details: { chainRef },
    });
  }
}

export class NetworkNamespaceUnsupportedError extends ArxBaseError {
  static readonly code = "network.namespace_unsupported";

  constructor(namespace: Namespace) {
    super(`Networks are not configured for namespace "${namespace}".`, {
      code: NetworkNamespaceUnsupportedError.code,
      details: { namespace },
    });
  }
}

export class NetworkSelectionMissingError extends ArxBaseError {
  static readonly code = "network.selection_missing";

  constructor(namespace: Namespace) {
    super(`Namespace "${namespace}" has no selected network.`, {
      code: NetworkSelectionMissingError.code,
      details: { namespace },
    });
  }
}

export class BuiltinNetworkConflictError extends ArxBaseError {
  static readonly code = "network.builtin_conflict";

  constructor(chainRef: ChainRef) {
    super(`Custom network "${chainRef}" conflicts with a builtin network.`, {
      code: BuiltinNetworkConflictError.code,
      details: { chainRef },
    });
  }
}
