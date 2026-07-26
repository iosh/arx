import { ArxBaseError } from "../../errors.js";
import type { ChainRef } from "../../networks/chainRef.js";

const TRANSACTION_TYPE_LABELS = {
  legacy: "legacy",
  eip2930: "EIP-2930",
  eip1559: "EIP-1559",
} as const;

export class Eip155FeeModelUnsupportedError extends ArxBaseError {
  static readonly code = "eip155.transaction.fee_model_unsupported";

  constructor(chainRef: ChainRef) {
    super("Network does not support EIP-1559 transaction fees.", {
      code: Eip155FeeModelUnsupportedError.code,
      details: { chainRef },
    });
  }
}

export class Eip155PriorityFeeExceedsMaxFeeError extends ArxBaseError {
  static readonly code = "eip155.transaction.priority_fee_exceeds_max_fee";

  constructor(input: { maxFeePerGas: string; maxPriorityFeePerGas: string }) {
    super("Max priority fee cannot exceed max fee.", {
      code: Eip155PriorityFeeExceedsMaxFeeError.code,
      details: input,
    });
  }
}

export class Eip155TransactionInvalidError extends ArxBaseError {
  static readonly code = "eip155.transaction.invalid";

  constructor(input: { chainRef: ChainRef; type: "legacy" | "eip2930" | "eip1559"; cause: unknown }) {
    super(`Invalid ${TRANSACTION_TYPE_LABELS[input.type]} transaction fields.`, {
      code: Eip155TransactionInvalidError.code,
      details: {
        chainRef: input.chainRef,
        type: input.type,
      },
      cause: input.cause,
    });
  }
}

export class Eip155TransactionSigningError extends ArxBaseError {
  static readonly code = "eip155.transaction.signing_failed";

  constructor(chainRef: ChainRef, cause: unknown) {
    super("Unable to sign the EIP-155 transaction.", {
      code: Eip155TransactionSigningError.code,
      details: { chainRef },
      cause,
    });
  }
}

export class Eip155TransactionSigningUnavailableError extends ArxBaseError {
  static readonly code = "eip155.transaction.signing_unavailable";

  constructor(chainRef: ChainRef, cause: unknown) {
    super("The EIP-155 transaction cannot be signed with the requested account.", {
      code: Eip155TransactionSigningUnavailableError.code,
      details: { chainRef },
      cause,
    });
  }
}
