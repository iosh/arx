import { ArxBaseError, type ErrorCause } from "../error.js";

export class WalletOperationBindingInvariantError extends ArxBaseError {
  static readonly code = "wallet.operation.binding_invariant";

  constructor(input: ErrorCause & { path: string; message?: string }) {
    super(input.message ?? `Wallet operation binding invariant failed for "${input.path}".`, {
      code: WalletOperationBindingInvariantError.code,
      details: { path: input.path },
      cause: input.cause,
    });
  }
}
