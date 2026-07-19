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
