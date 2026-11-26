import { ArxBaseError } from "../../errors.js";

export class Eip155InvalidChainIdError extends ArxBaseError {
  static readonly code = "eip155.invalid_chain_id";

  constructor(input: { value: string }) {
    super("Invalid EIP-155 chain ID.", {
      code: Eip155InvalidChainIdError.code,
      details: input,
    });
  }
}
