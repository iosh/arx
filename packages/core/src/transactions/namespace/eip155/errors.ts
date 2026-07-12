import { ArxBaseError } from "../../../errors.js";

export class Eip155ChainRefError extends ArxBaseError {
  static readonly code = "transaction.eip155.chain_ref_invalid";

  constructor(chainRef: string) {
    super(`Cannot derive EIP-155 chainId from chainRef "${chainRef}".`, {
      code: Eip155ChainRefError.code,
      details: { chainRef },
    });
  }
}

export class Eip155FeeOracleResponseError extends ArxBaseError {
  static readonly code = "transaction.eip155.fee_oracle.invalid_response";

  constructor(input: { method: string; value: unknown }) {
    super(`RPC method "${input.method}" returned an invalid fee value.`, {
      code: Eip155FeeOracleResponseError.code,
      details: {
        method: input.method,
        value: String(input.value),
      },
    });
  }
}

export class Eip155SigningAbortedError extends ArxBaseError {
  static readonly code = "transaction.eip155.signing_aborted";

  constructor() {
    super("Transaction signing aborted.", {
      code: Eip155SigningAbortedError.code,
    });
  }
}
