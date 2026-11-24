import { ArxBaseError } from "../errors.js";

export class ChainInvalidAddressError extends ArxBaseError {
  static readonly code = "chain.address.invalid";

  constructor(params: { namespace: string; field: "input" | "canonical" }) {
    super(`Invalid ${params.namespace} address.`, {
      code: ChainInvalidAddressError.code,
      details: { namespace: params.namespace, field: params.field },
    });
  }
}
