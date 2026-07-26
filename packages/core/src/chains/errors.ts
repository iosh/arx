import { ArxBaseError } from "../errors.js";

export class ChainInvalidAddressError extends ArxBaseError {
  static readonly code = "chain.address.invalid";

  constructor(params: { namespace: string; field: "input" | "canonical" }) {
    super(`Invalid ${params.namespace} address.`, {
      code: params.namespace === "eip155" ? "eip155.address.invalid" : ChainInvalidAddressError.code,
      details: { namespace: params.namespace, field: params.field },
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
